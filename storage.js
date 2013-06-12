var mongo = require("mongodb");
var ff = require("ff");
var url = require("url");
var _ = require("underscore");
var Backend = require("./mongo");

var validation = require("./validation");

//default user structure
var userStructure = {
	name: {type: "String", minlen: 3},
	email: {type: "String", minlen: 3},
	pass: {type: "String", minlen: 3},
	role: {type: "String", values: ["admin", "member"], default: "member"}
};

function Storage (opts) {
	this.app = opts.name;

	this.structure = opts.structure;
	this.config = opts.config;
	
	//every app needs a users collection
	if (!this.structure.users) {
		this.structure.users = userStructure;
	} else {
		//allow customization of the structure
		_.defaults(this.structure.users, userStructure);
	}

	//connect to the database backend
	this.db = new Backend(opts);
}

function parseRequest (req) {
	var query = url.parse(req.url, true);
	var parts = query.pathname.split("/");
	var method = req.method && req.method.toUpperCase();
	var error = null;

	//trim uneeded parts of the request
	if (parts[0] == '') { parts.splice(0, 1); }
	if (parts[parts.length - 1] == '') { parts.splice(parts.length - 1, 1); }
	if (parts[0] == 'data') { parts.splice(0, 1); }

	var table = parts[0];
	var field = parts[1];
	var value = parts[2];
	var cmd   = parts[3];

	if (field == "_id") {
		//if this value is incorrect, dont crash
		//the darn server
		try {
			value = mongo.ObjectID(value);
		} catch (e) {
			value = "";
		}
	}

	//set some default permissions if not defined
	//and came from a user request
	if (method) {
		if (!req.permission) {
			if (method === "DELETE") { req.permission = "owner"; }
			if (method === "POST") {
				if (parts.length >= 3) { req.permission = "owner"; }
				else { req.permission = "member"; }
			}
			if (method === "GET") { req.permission = "anyone"; }
		}

		//ensure logged in if permission is not stranger/anyone
		if (req.permission !== "stranger" && req.permission !== "anyone") {
			if (!req.session.user) { error = "You do not have permission"; }
		}
	}

	return {
		table: table,
		field: field,
		value: value,
		cmd: cmd,
		query: query.query, //query params
		parts: parts.length,
		error: error
	}
}

/**
* Determines if the first provided role inherits
* the second role.
* e.g. admin > member
*/
Storage.prototype.inheritRole = function (test, role) {
	var roleIndex = this.structure.users.role.values.indexOf(role);
	var testIndex = this.structure.users.role.values.indexOf(test);

	if (roleIndex === -1 || testIndex === -1) {
		return false;
	}

	return (testIndex <= roleIndex);
}

/**
* Creates an object of fields to exclude from
* the selection.
*/
Storage.prototype.validateFields = function (permission, table) {
	var rules = this.structure[table];
	var omit = {};

	for (var key in rules) {
		var rule = rules[key];

		//create the access r/w object
		var access = typeof rule.access === "string" ? {
			r: rule.access,
			w: rule.access
		} : rule.access;

		//skip if not defined or anyone can view
		if (!access || access.r === "anyone") { continue; }

		//leave out certain fields that the viewer can't access
		if (!this.inheritRole(permission, access.r)) {
			omit[key] = 0;
		}
	}

	return omit;
}

/**
* Validates an object for update or insertion
* into a collection using the provided rules.
*/
Storage.prototype.validateData = function (type, permission, data, table) {
	var rules = this.structure[table] || {};
	var errors = {};
	var errorFlag = false;

	//should not be multilevel object
	//look for special data commands
	for (var key in data) {
		var rule = rules[key];
		if (!rule) {
			//in strict mode, don't allow unknown fields
			if (this.config.strict) {
				delete data[key];
			}

			continue;
		}

		var error = validation.test(data[key], rule);
		if (error.length) {
			errors[key] = error.join("\n");
			errorFlag = true;
		}
		
		//determine the access of the field
		if (!rule.access) { continue; }
		var access = rule.access.w || rule.access;

		//if the user permission does not have access,
		//delete the value or set to default
		if (!this.inheritRole(permission, access)) {
			delete data[key];

			if ("default" in rule) { data[key] = rule["default"]; }
		}
	}

	//for insertations, need to make sure
	//required fields are defined, otherwise
	//set to default value
	if (type === "insert") {
		for (var key in rules) {
			//already been validated above
			if (key in data) { continue; }
			if (typeof rules[key] !== "object") { continue; }

			//required value so create error
			if (rules[key].required) {
				errors[key] = "Cannot find required field: " + key;
				errorFlag = true;
			}
			//default value
			else if ("default" in rules[key]) {
				data[key] = rules[key]["default"];
			}
		}
	}
	
	return errorFlag && errors;
}

/**
* Insert data into a collection
* through a REST api
*/
Storage.prototype.post = function (req, body, next) {
	var opts = parseRequest(req);
	var data = body;
	var permission = req.permission;
	var where = {};

	if (opts.error) { return next(opts.error); }

	if (!opts.cmd) {
		//need to use $set for updating
		//update when there are 3 url parts
		if (opts.parts >= 3) {
			data = {"$set": body};
		}
	} else {
		//format for the command
		if (opts.cmd === "inc") {
			data = {"$inc": body};
		}
	}

	//special permission
	if (permission === "owner") {
		where['_creator'] = req.session.user._id;
	}

	if (opts.parts >= 3) {
		//add a constraint to the where clause
		where[opts.field] = opts.value;

		var errors = this.validateData(
			"update", 
			permission,
			body, 
			opts.table
		);

		//return an error if validation failed.
		if (errors) {
			return next(errors);
		}

		//update hidden fields
		var metadata = {};
		metadata['_lastUpdated'] = Date.now();
		if (req.session && req.session.user) {
			metadata['_lastUpdator'] = req.session.user._id;
			metadata['_lastUpdatorName'] = req.session.user.name;
		}

		//dont create if it doesn't exist, apply to multiple
		this.db.collection(opts.table).update(where, data, next);

		this.db.collection(opts.table).update(where, {
			"$set": metadata
		}, function(){});
	} else {
		//validate the data against the rules
		var errors = this.validateData(
			"insert", 
			permission, 
			data, 
			opts.table
		);

		//return an error if validation failed.
		if (errors) {
			return next(errors);
		}

		if (req.session && req.session.user) {
			data['_creator'] = req.session.user._id;
			data['_creatorName'] = req.session.user.name;
		}

		data['_created'] = Date.now();
		this.db.collection(opts.table).insert(data, next);
	}
};

/**
* Retrieve data from a collection
* through a REST api
*/
Storage.prototype.get = function (req, next) {
	req.method = "get";
	var opts = parseRequest(req);
	var queryOpts = {};
	var permission = req.permission;
	var where = {};

	if (opts.error) { return next(opts.error); }

	//match the owners at row level
	if (permission === "owner" && req.session.user.role !== "admin") {
		where['_creator'] = req.session.user._id;
	}

	var omit = this.validateFields(permission, opts.table) || {};

	//parse limit options
	if (opts.query.limit) {
		var limit = opts.query.limit.split(",");
		queryOpts.limit = +limit[1] || +limit[0];
		if (limit.length == 2) { queryOpts.skip = +limit[0]; }
	}

	//parse sorting option
	if (opts.query.sort) {
		var sort = opts.query.sort.split(",");
		var sorter = sort[1] === "desc" ? -1 : 1;
		queryOpts.sort = [[sort[0], sorter]];
	}

	if (opts.parts >= 3) {
		//add the where constraint
		where[opts.field] = opts.value;

		this.db.collection(opts.table).find(where, omit, queryOpts, function (err, arr) {
			if (err) {
				return next(err);
			}

			if (opts.query.single) {
				next(null, arr[0]);
			} else {
				next(null, arr);
			}
		});
	}
	//1 part means list data 
	else if (opts.parts === 1) {
		this.db.collection(opts.table).find(where, omit, queryOpts, next);
	}
	else {
		next(null, {error: "Invalid request"});
	}
}

/**
* Remove data from a collection
* through a REST api
*/
Storage.prototype.delete = function (req, next) {
	var opts = parseRequest(req);
	var permission = req.permission;
	var where = {};

	if (opts.error) { return next(opts.error); }
	
	//if not the admin, default to owner
	if (permission === "owner" && req.session.user.role !== "admin") {
		where["_creator"] = req.session.user._id;
	}

	if (opts.parts >= 3) {
		where[opts.field] = opts.value;
	}

	//truncate table
	this.db.collection(opts.table).remove(where, next);
};

Storage.init = function (app) {
	return new Storage(app);
}

module.exports = Storage;
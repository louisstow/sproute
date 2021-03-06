var ff = require("ff");
var fs = require("fs");
var path = require("path");
var url = require("url");
var _ = require("underscore");

var Class = require("./lib/Class");
var Validation = require("./lib/Validation");

//default user structure
var user_structure = {
	name: {type: "String", minlen: 3, unique: true, required: true},
	pass: {type: "String", minlen: 3, required: true, access: "owner"},
	_salt: {type: "String", access: "owner"},
	role: {type: "String", values: ["admin", "member"], default: "member"}
};

function randString () {
	return Math.random().toString(36).substr(2);
}

function parseRequest (req) {
	var query = url.parse(req.url, true);
	var parts = query.pathname.split("/");
	var method = req.method && req.method.toUpperCase();

	// trim uneeded parts of the request
	if (parts[0] == '') { parts.splice(0, 1); }
	if (parts[parts.length - 1] == '') { parts.splice(parts.length - 1, 1); }
	if (parts[0] == 'data') { parts.splice(0, 1); }

	var table = parts[0];
	var field = parts[1];
	var value = parts[2];
	var cmd   = parts[3];

	// can have a command on table
	if (parts.length == 2) {
		cmd = field;
	}

	console.log("Request", table, field, value, cmd)

	// leave a warning if no permission on a writable request
	if ((method == "POST" || method == "DELETE") && !req.permission) {
		console.warn("You should add a permission for `"+req.url+"`.")
	}

	// modify the req object
	_.extend(req, {
		table: table,
		field: field,
		value: value,
		cmd: cmd,
		query: query.query, //query params
		type: parts.length >= 3 ? "filter" : "all",
		isLogged: !!(req.session && req.session.user)
	});
}

var Storage = Class.extend({
	init: function (opts) {
		Storage.super(this, "init");

		this.name = opts.name;
		this.schema = opts.schema;
		this.config = opts.config;
		this.dir = opts.dir;
		
		// every app with storage needs a users collection
		if (!this.schema.users) {
			this.schema.users = user_structure;
		} else {
			//allow customization of the structure
			_.defaults(this.schema.users, user_structure);
		}

		var dbConfig = this.config.db;
		dbConfig.name = this.name;

		//connect to the database backend
		this.db = new (require("./db/" + opts.config.db.type))(opts);
		
		var f = ff(this, function () {
			this.db.open(dbConfig, f.slot());
		}, function () {
			var group = f.group();

			for (var table in this.schema) {
				this.db.createTable(table, this.schema[table], group());
			}
		}, function () {
			console.log("CREATED DBS")
			this.emit("created");
		}).error(function (err) {
			console.warn(err)
		});
	},

	/**
	* Returns an array of fields that should
	* be omitted from the response due to permissions.
	*/
	disallowedFields: function (permission, table) {
		var rules = this.schema[table];
		var omit = [];

		for (var key in rules) {
			var rule = rules[key];

			//create the access r/w object
			var access = typeof rule.access === "string" ? {
				r: rule.access,
				w: rule.access
			} : rule.access;

			// skip if not defined or anyone can view
			if (!access || access.r === "anyone" || access.r === "owner") { continue; }

			//leave out certain fields that the viewer can't access
			if (this.inheritRole(permission, access.r) === false) {
				omit.push(key);
			}
		}

		return omit;
	},

	ownerFields: function (table) {
		var rules = this.schema[table];
		var fields = [];

		for (var key in rules) {
			var rule = rules[key];

			var access = typeof rule.access === "string" ? {
				r: rule.access
			} : rule.access;

			if (access && access.r == "owner") {
				fields.push(key)
			}
		}

		return fields;
	},

	/**
	* Determine if the test role supersedes
	* the required role.
	*/
	inheritRole: function (test, role) {
		var roleIndex = this.schema.users.role.values.indexOf(role);
		var testIndex = this.schema.users.role.values.indexOf(test);

		// cannot find the role so assume no
		if (roleIndex === -1 || testIndex === -1) {
			return false;
		}

		// admin should always return true
		if (test == 'admin') {
			return true;
		}

		return (testIndex <= roleIndex);
	},

	validateData: function (req) {
		var rules = this.schema[req.table] || {};
		var errors = [];
		var data = req.body || {};
		var permission = null;
		
		if (req.session && req.session.user) {
			permission = req.session.user.role;
		}

		for (var key in data) {
			var rule = rules[key];

			if (!rule) {
				// in strict mode, don't allow unknown fields
				if (this.config.strict) { delete data[key]; }
				continue;
			}

			var dataType = (rule.type || rule).toLowerCase();
			if (dataType === "number") {
				data[key] = parseFloat(data[key], 10);
			}

			var error = Validation.test(data[key], rule);
			if (error.length) {
				errors.push({message: error.join("\n") });
			}
			
			// determine the access of the field
			if (!rule.access) { continue; }
			var access = rule.access.w || rule.access;

			// handled elsewhere
			if (access === "owner") { continue; }

			// if the user permission does not have access,
			// delete the value or set to default
			if (this.inheritRole(permission, access) === false) {
				delete data[key];
			}
		}

		// for insertations, need to make sure
		// required fields are defined, otherwise
		// set to default value
		if (req.type === "all") {
			for (var key in rules) {
				var rule = rules[key];

				//already been validated above
				if (key in data) { continue; }
				if (typeof rules[key] !== "object") { continue; }

				//required value so create error
				if (rules[key].required) {
					errors.push({message: "Cannot find required field: `" + key + "`."});
				}

				//default value
				if ("default" in rules[key]) {
					data[key] = rules[key]["default"];
				}
			}
		}
		
		console.log("ERRORS", errors)
		return errors.length && errors;
	},

	post: function (req, next) {
		parseRequest(req);

		var conditions = {};
		var data = req.body;

		// special permission
		if (req.permission === "owner" && req.session.user.role !== "admin") {
			conditions['_creator'] = req.session.user._id;
		}

		// special case, unfortunately :\
		if (req.cmd == "in") {
			return this.get(req, next);
		}

		// validate the updated data
		var errors = this.validateData(req);
		if (errors) {
			return next(errors);
		}

		if (req.cmd == "inc") {
			conditions[req.field] = req.value;
			console.log("increment", req.table, conditions, data)
			this.db.increment(req.table, conditions, data, next);
		} else if (req.type == "filter") {
			// add a constraint to the where clause
			conditions[req.field] = req.value;

			// update hidden fields
			data['_lastUpdated'] = Date.now();
			if (req.session && req.session.user) {
				data['_lastUpdator'] = req.session.user._id;
				data['_lastUpdatorName'] = req.session.user.name;
			}

			this.db.modify(req.table, conditions, data, next);
		} else {
			// add the user metadata
			if (req.session && req.session.user) {
				data['_creator'] = req.session.user._id;
				data['_creatorName'] = req.session.user.name;
			}

			data['_created'] = Date.now();
			this.db.write(req.table, data, next);
		}
	},

	// req: Request object 
	// - session: 
	// - method:
	// - url:
	// - permission:
	// next: Callback
	get: function (req, next) {
		parseRequest(req);

		var options = {};
		var conditions = {};

		// match the owners at row level
		if (req.permission === "owner" && req.session.user.role !== "admin") {
			conditions['_creator'] = req.session.user._id;
		}

		var omit = this.disallowedFields(req.permission, req.table);
		var ownerFields = this.ownerFields(req.table);

		// parse limit options
		if (req.query.limit) {
			var limit = req.query.limit.split(",");
			options.limit = +limit[1] || +limit[0];
			if (limit.length == 2) { options.skip = +limit[0]; }
		}

		// parse sorting option
		if (req.query.sort) {
			var sort = req.query.sort.split(",");
			var sorter = sort[1] === "desc" ? -1 : 1;
			options.sort = [[sort[0], sorter]];
		}

		// values in array
		if (req.cmd && req.type === "all") {
			if (!req.body || !Object.keys(req.body).length) { return next("Body empty"); }
			options = {"in": req.body};
		}

		if (req.type == "filter") {
			// add the where constraint
			conditions[req.field] = req.value;
		}

		console.log(req.table, conditions, options)
		this.db.read(req.table, conditions, options, function (err, arr) {
			console.log("GET", arguments);
			if (err) {
				return next(err);
			}

			// omit fields not allowed
			for (var i = 0; i < arr.length; ++i) {
				arr[i] = _.omit(arr[i], omit);

				var owner = arr[i]._creator || arr[i]._id;
				
				if (!req.isLogged || owner != req.session.user._id) {
					for (var j = 0; j < ownerFields.length; ++j) {
						delete arr[i][ownerFields[j]];
					}
				}
			}

			if (req.query.single) {
				next(null, arr[0]);
			} else {
				next(null, arr);
			}
		});
	},

	delete: function () {
		parseRequest(req);
		var conditions = {};
		
		//if not the admin, default to owner
		if (permission === "owner" && req.session.user.role !== "admin") {
			conditions["_creator"] = req.session.user._id;
		}

		if (req.type == "filter") {
			conditions[req.field] = req.value;
		}

		//truncate table
		this.db.remove(req.table, conditions, next);
	}
});


module.exports = Storage;

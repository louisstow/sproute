var mongo = require("mongodb");
var ff = require("ff");
var url = require("url");
var _ = require("underscore");

var validation = require("./validation");

var HOST = "localhost";
var PORT = 27017;
var OPTS = {
	w: 1,
	size: 5000000, //5,000,000 byes = 5MB
	strict: true
};

var userStructure = {
	name: {type: "String", minlen: 3},
	email: {type: "String", minlen: 3},
	pass: {type: "String", minlen: 3}
};

function Storage (app, structure, server) {
	this.app = app;
	this.db = new mongo.Db(app, new mongo.Server(HOST, PORT), OPTS);
	this.structure = structure;

	//every app needs a users collection
	if (!structure.users) {
		structure.users = userStructure;
	} else {
		//allow customization of the structure
		_.extend(structure.users, userStructure);
	}

	var self = this;
	this.db.open(function (err, db) {
		//log the result
		console.log(
			err ? "Error connecting to" : "Connected to", 
			app, "on", HOST + ":" + PORT
		);

		if (err) {
			return console.error(err);
		}

		self.onready && self.onready.call(self);

		for (var table in structure) {
			//horray, a fucking closure
			(function (table) {
				db.createCollection(table, OPTS, function (err) {
					console.log("Collection created", err, table);
					if (!err && table === "users") {
						//this should come from somewhere else
						db.collection("users").insert({
							name: "admin",
							email: "admin@admin.com",
							pass: "admin"
						}, function () {});
					}
				});
			})(table)	
		}
	});

	this.db.on("error", function () {
		console.error(arguments)
	});
}

function parseRequest (req) {
	var query = url.parse(req.url, true);
	var parts = query.pathname.split("/");

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

	return {
		table: table,
		field: field,
		value: value,
		cmd: cmd,
		query: query.query, //query params
		parts: parts.length
	}
}

Storage.prototype.validateData = function (required, data, table) {
	var rules = this.structure[table];
	var errors = {};
	var errorFlag = false;

	//should not be multilevel object
	//look for special data commands
	for (var key in data) {
		if (rules[key]) {
			var error = validation.test(data[key], rules[key]);
			if (error.length) {
				errors[key] = error;
				errorFlag = true;
			}
		}
	}

	if (required) {
		for (var key in rules) {
			if (!data[key]) {
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

	if (opts.parts >= 3) {
		var query = {};
		query[opts.field] = opts.value;

		var errors = this.validateData(false, body, opts.table);

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

		var qOpts = { upsert: false, multi: true, w: OPTS.w };

		//dont create if it doesn't exist, apply to multiple
		this.db.collection(opts.table).update(query, data, qOpts, next);

		this.db.collection(opts.table).update(query, {
			"$set": metadata
		}, function(){});
	} else {
		var errors = this.validateData(true, data, opts.table);

		//return an error if validation failed.
		if (errors) {
			return next(errors);
		}

		if (req.session && req.session.user) {
			data['_creator'] = req.session.user._id;
			data['_creatorName'] = req.session.user.name;
		}

		data['_created'] = Date.now();
		this.db.collection(opts.table).insert(data, OPTS, next);
	}
};

/**
* Retrieve data from a collection
* through a REST api
*/
Storage.prototype.get = function (req, next) {
	var opts = parseRequest(req);
	var queryOpts = {};

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
		var query = {};
		query[opts.field] = opts.value;

		this.db.collection(opts.table).find(query, queryOpts).toArray(function (err, arr) {
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
		this.db.collection(opts.table).find({}, queryOpts).toArray(next);
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

	if (opts.parts >= 3) {
		var query = {};
		query[opts.field] = opts.value;

		//dont create if it doesn't exist, apply to multiple
		this.db.collection(opts.table).remove(query, OPTS, next);
	} else {
		//truncate table
		this.db.collection(opts.table).remove({}, OPTS, next);
	}
};

Storage.init = function (app) {
	return new Storage(app);
}

module.exports = Storage;
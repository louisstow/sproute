var mongo = require("mongodb");
var ff = require("ff");
var url = require("url");
var _ = require("underscore");

var HOST = "localhost";
var PORT = 27017;
var OPTS = {
	w: 1,
	capped: true,
	size: 5000000 //5,000,000 byes = 5MB
};

var userStructure = {
	name: "String",
	email: "String",
	pass: "String"
};

function Storage (app, structure, server) {
	this.app = app;
	this.db = new mongo.Db(app, new mongo.Server(HOST, PORT), OPTS);

	var self = this;

	//every app needs a users collection
	if (!structure.users) {
		structure.users = userStructure;
	} else {
		//allow customization of the structure
		_.extend(structure.users, userStructure);
	}

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
			db.createCollection(table, OPTS, function () {
				console.log("Collection created");
			});
		}
	});

	this.db.on("error", function () {
		console.error(arguments)
	});
}

/**
* Insert data into a collection
* through a REST api
*/
Storage.prototype.post = function (req, data, next) {
	var query = url.parse(req, true);
	var parts = query.pathname.split("/");

	//trim uneeded parts of the request
	if (parts[0] == '') { parts.splice(0, 1); }
	if (parts[parts.length - 1] == '') { parts.splice(parts.length - 1, 1); }
	if (parts[0] == 'data') { parts.splice(0, 1); }

	var table = parts[0];
	var field = parts[1];
	var value = parts[2];

	if (parts.length === 3) {
		var query = {};
		query[field] = value;

		var opts = { upsert: false, multi: true, w: OPTS.w };

		//dont create if it doesn't exist, apply to multiple
		this.db.collection(table).update(query, data, opts, next);
	} else {
		this.db.collection(table).insert(data, OPTS, next);
	}
};

/**
* Retrieve data from a collection
* through a REST api
*/
Storage.prototype.get = function (req, next) {
	var q = url.parse(req, true);
	var parts = q.pathname.split("/");

	//trim uneeded parts of the request
	if (parts[0] == '') { parts.splice(0, 1); }
	if (parts[parts.length - 1] == '') { parts.splice(parts.length - 1, 1); }
	if (parts[0] == 'data') { parts.splice(0, 1); }

	var table = parts[0];
	var field = parts[1];
	var value = parts[2];

	var opts = {};

	if (q.query.limit) {
		var limit = q.query.limit.split(",");
		opts.limit = +limit[1] || +limit[0];
		if (limit.length == 2) { opts.skip = +limit[0]; }
	}

	if (q.query.sort) {
		var sort = q.query.sort.split(",");
		var sorter = sort[1] === "desc" ? -1 : 1;
		opts.sort = [[sort[0], sorter]];
	}

	//3 parts means single item
	if (parts.length === 3) {
		var query = {};
		query[field] = value;

		if (field === "_id") {
			query[field] = mongo.ObjectID(value);
		}

		this.db.collection(table).find(query, opts).toArray(function (err, arr) {
			if (err) {
				return next(err);
			}

			if (q.query.single) {
				next(null, arr[0]);
			} else {
				next(null, arr);
			}
		});
	}
	//1 part means list data 
	else if (parts.length === 1) {
		this.db.collection(table).find({}, opts).toArray(next);
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
	var query = url.parse(req, true);
	var parts = query.pathname.split("/");

	//trim uneeded parts of the request
	if (parts[0] == '') { parts.splice(0, 1); }
	if (parts[parts.length - 1] == '') { parts.splice(parts.length - 1, 1); }
	if (parts[0] == 'data') { parts.splice(0, 1); }

	var table = parts[0];
	var field = parts[1];
	var value = parts[2];

	if (parts.length === 3) {
		var query = {};
		query[field] = value;

		//dont create if it doesn't exist, apply to multiple
		this.db.collection(table).remove(query, OPTS, next);
	} else {
		this.db.collection(table).remove({}, OPTS, next);
	}
};

Storage.init = function (app) {
	return new Storage(app);
}

module.exports = Storage;
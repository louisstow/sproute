var mongo = require("mongodb");
var ff = require("ff");
var url = require("url");

var HOST = "localhost";
var PORT = 27017;
var OPTS = {
	w: 1,
	capped: true,
	size: 5000000 //5,000,000 byes = 5MB
};

function Storage (app, structure, server) {
	this.app = app;
	this.db = new mongo.Db(app, new mongo.Server(HOST, PORT), OPTS);

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
			db.createCollection(table, OPTS, function () {
				console.log("Collection created");
			});
		}
	});

	this.db.on("error", function () {
		console.error(arguments)
	});
}

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

	//3 parts means single item
	if (parts.length === 3) {
		var query = {};
		query[field] = value;

		if (field === "_id") {
			query[field] = mongo.ObjectID(value);
		}

		if (q.query.single) {
			this.db.collection(table).find(query).toArray(function (err, arr) {
				if (err) next(err, null)
				else next(null, arr[0]);
			});
		} else {
			this.db.collection(table).find(query).toArray(next);	
		}
		
	}
	//1 part means list data 
	else if (parts.length === 1) {
		
		this.db.collection(table).find({}).toArray(next);
	}
	else {
		next(null, {error: "Invalid request"});
	}
}

Storage.init = function (app) {
	return new Storage(app);
}

module.exports = Storage;
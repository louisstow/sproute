var mongo = require("mongodb");
var ff = require("ff");

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

Storage.prototype.getRows = function (table, next) {
	this.db[table].find(next);
};

Storage.prototype.addRow = function (table, data, next) {
	this.db[table].insert(data, next);
};

Storage.prototype.get = function (url, next) {
	var parts = url.split("/");

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

		this.db.collection(table).find(query, next);
	}
	//1 part means list data 
	else if (parts.length === 1) {
		
		this.db.collection(table).find({}).toArray(next);
	}
	console.log(parts)
}

Storage.init = function (app) {
	return new Storage(app);
}

module.exports = Storage;
/**
* mongo.connect(opts);
* mongo.insert();
* mongo.update();
* mongo.find();
*/
var mongo = require("mongodb");
var ff = require("ff");

var HOST = "localhost";
var PORT = 27017;

function Backend(opts) {
	this.open(opts);
};

//save mongo options
var opts = {
	open: { w: 1, strict: true, safe: true },
	collection: { strict: true },
	insert: { w: 1, strict: true },
	update: { upsert: false, multi: true, w: 1, strict: true },
	find: {}
}

Backend.prototype = {
	error: function () {
		console.error("Error opening database", this.name);
		console.error(arguments)
	},

	open: function (opts) {
		var dbOpts = opts.config.db || {};
		this.name = opts.name;

		//setup the mongo db object
		this.db = new mongo.Db(
			opts.name, 
			new mongo.Server(dbOpts.host || HOST, dbOpts.port || PORT), 
			opts.open
		);
		
		var f = ff(this, function () {
			this.db.open(f.slot());
			this.db.on("error", this.error);
		}, function (db) {
			//loop over structure and create
			//a collection
			Object.keys(opts.structure).forEach(function (table) {
				db.createCollection(table, opts.open, function (err) {
					console.log("Collection created", err, table);
					if (!err && table === "users") {
						//TODO: alert App.js
						opts.createAdmin();
					}
				});
			});
		}).error(this.error);
	},

	collection: function (table) {
		this.currentTable = table;
		return this;
	},

	insert: function (data, next) {
		next = next || function () {};

		var f = ff(this, function () {
			this.db.collection(this.currentTable, opts.collection, f.slot());	
		}, function (collection) {
			collection.insert(data, opts.insert, f.slot());
		}).cb(next);
	},

	update: function (where, data, next) {
		next = next || function () {};

		var f = ff(this, function () {
			this.db.collection(this.currentTable, opts.collection, f.slot());	
		}, function (collection) {
			collection.update(where, data, opts.update, f.slot());
		}).cb(next);
	},

	remove: function (data, next) {
		next = next || function () {};

		var f = ff(this, function () {
			this.db.collection(this.currentTable, opts.collection, f.slot());	
		}, function (collection) {
			collection.remove(data, opts.remove, f.slot());
		}).cb(next);
	},

	find: function (where, omit, opts, next) {
		var f = ff(this, function () {
			this.db.collection(this.currentTable, opts.collection, f.slot());	
		}, function (collection) {
			collection.find(where, omit, opts).toArray(next)
		}).error(next);
	}
};

module.exports = Backend;
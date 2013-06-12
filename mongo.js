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
var OPTS = {
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
			OPTS.open
		);
		
		var self = this;
		var f = ff(this, function () {
			this.db.open(f.slot());
			this.db.on("error", this.error);
		}, function (db) {
			//loop over structure and create
			//a collection
			Object.keys(opts.structure).forEach(function (table) {
				var fields = opts.structure[table];

				//create the collection
				db.createCollection(table, OPTS.open, function (err, collection) {
					console.log("Collection created", err, table);
					//create the admin account
					if (!err && table === "users") { opts.createAdmin(); }

					for (var field in fields) {
						//ensure unique index
						if (fields[field].unique) {
							var obj = {};
							obj[field] = 1;
							self.collection(table).ensureUnique(obj);
						}
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
			this.db.collection(this.currentTable, OPTS.collection, f.slot());	
		}, function (collection) {
			collection.insert(data, OPTS.insert, f.slot());
		}).cb(next);
	},

	update: function (where, data, next) {
		next = next || function () {};

		var f = ff(this, function () {
			this.db.collection(this.currentTable, OPTS.collection, f.slot());	
		}, function (collection) {
			collection.update(where, data, OPTS.update, f.slot());
		}).cb(next);
	},

	remove: function (data, next) {
		next = next || function () {};

		var f = ff(this, function () {
			this.db.collection(this.currentTable, OPTS.collection, f.slot());	
		}, function (collection) {
			collection.remove(data, OPTS.remove, f.slot());
		}).cb(next);
	},

	find: function (where, omit, opts, next) {
		if (arguments.length === 2) {
			next = omit;
			omit = {};
			opts = {};
		}

		var f = ff(this, function () {
			this.db.collection(this.currentTable, OPTS.collection, f.slot());	
		}, function (collection) {
			collection.find(where, omit, opts).toArray(next)
		}).error(next);
	},

	ensureIndex: function (fields, opts, next) {
		next = next || function () {};

		var f = ff(this, function () {
			this.db.collection(this.currentTable, OPTS.collection, f.slot());	
		}, function (collection) {
			collection.ensureIndex(fields, opts, f.slot());
		}).cb(next);
	},

	ensureUnique: function (fields, next) {
		return this.ensureIndex(fields, {unique: true}, next);
	}
};

module.exports = Backend;
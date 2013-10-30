var mongo = require("mongodb");
var ff = require("ff");
var Interface = require("./Interface");

var HOST = "localhost";
var PORT = 27017;

// mongo options
var mongo_options = {
	open: { w: 1, strict: true, safe: true },
	collection: { strict: true },
	insert: { w: 1, strict: true },
	update: { upsert: false, multi: true, w: 1, strict: true },
	find: {}
}

var Mongo = Interface.extend({
	open: function (config, next) {
		// setup the mongo connection
		this.connection = new mongo.Db(
			config.name, 
			new mongo.Server(config.host || HOST, config.port || PORT), 
			mongo_options.open
		);

		this.connection.open(next);
	},

	createTable: function (table, fields, next) {
		try {
			this.connection.createCollection(table, mongo_options.open, next)
		} catch (err) {
			this.emit("table-exists", table);
		}
	},

	createIndex: function (table, fields, config, next) {
		var f = ff(this, function () {
			this.connection.collection(table, mongo_options.collection, f.slot());	
		}, function (collection) {
			collection.ensureIndex(fields, config, f.slot());
		}).cb(next);
	},

	read: function (table, conditions, options, next) {
		var f = ff(this, function () {
			this.connection.collection(table, mongo_options.collection, f.slot());	
		}, function (collection) {
			collection.find(conditions, options).toArray(next)
		}).error(next);
	},

	write: function (table, data, next) {
		var f = ff(this, function () {
			this.connection.collection(table, mongo_options.collection, f.slot());	
		}, function (collection) {
			collection.insert(data, mongo_options.insert, f.slot());
		}).cb(next);
	},

	modify: function (table, conditions, data, next) {
		var f = ff(this, function () {
			this.connection.collection(table, mongo_options.collection, f.slot());	
		}, function (collection) {
			collection.update(conditions, {"$set": data}, mongo_options.update, f.slot());
		}).cb(next);
	},

	remove: function (table, conditions, next) {
		var f = ff(this, function () {
			this.connection.collection(table, mongo_options.collection, f.slot());	
		}, function (collection) {
			collection.remove(conditions, mongo_options.remove, f.slot());
		}).cb(next);
	},

	increment: function (table, data, next) {
		var f = ff(this, function () {
			this.connection.collection(table, mongo_options.collection, f.slot());	
		}, function (collection) {
			collection.update({"$inc": data}, mongo_options.modify, f.slot());
		}).cb(next);
	}
});

module.exports = Mongo;
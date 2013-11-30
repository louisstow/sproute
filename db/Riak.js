var riak = require("riak-js");
var ff = require("ff");
var Interface = require("./Interface");

function getKey () {
	Array.prototype.unshift.call(arguments, "db");
	return Array.prototype.join.call(arguments, ":");
}

function getUUID () {
	return (Math.random() * 100000).toString(36).replace(".", "");
}
/**
* TODO
* - Get all in collection
* - IN query filter
*/

var Riak = Interface.extend({
	open: function (config, next) {
		this.bucket = config.name;
		this.connection = riak.getClient();
		this.indexes = {};

		next();
	},

	createTable: function (table, fields, next) {
		this.indexes[table] = {};

		for (var key in fields) {
			if (fields[key].unique) {
				this.indexes[table][key] = true;
			}
		}

		console.log(this.indexes)
	},

	createIndex: function (table, fields, config, next) {
		
	},

	read: function (table, conditions, options, next) {
		var f = ff(this, function () {
			if (conditions._id) {
				this.connection.get(this.bucket, getKey(table, conditions._id), {}, f.slot())
			} else {
				this.connection.query(this.bucket, conditions, {}, f.slot());
			}
		}, function (results) {
			// transform an array of keys
			if (Array.isArray(results)) {
				var g = f.group();
				for (var i = 0; i < results.length; ++i) {
					this.connection.get(this.bucket, results[i], g());
				}
			} else {
				f.succeed([results]);
			}
		}, function (results) {
			// exit early with no results
			if (!results) {
				return f.succeed([]);
			}

			if (options.limit) {
				results = results.slice(options.skip || 0, options.limit);
			}

			// transform back to JSON
			for (var i = 0; i < results.length; ++i) {
				try {
					results[i] = JSON.parse(results[i]);
				} catch (err) {
					results.splice(i--, 1);
					continue;
				}

				// do further filtering
				for (var key in conditions) {
					if (results[i][key] != conditions[key]) {
						results.splice(i--, 1);
					}
				}
			}

			if (options.sort) {
				var key = options.sort[0];
				var direction = options.sort[1];

				function ascSort (a, b) {
					return a[key] > b[key];
				}

				function descSort (a, b) {
					return a[key] < b[key];
				}

				results.sort(direction == -1 ? descSort : ascSort);
			}
			
			f.pass(results);
		}).cb(next)
	},

	write: function (table, data, next) {
		if (!data._id) { data._id = getUUID(); }

		var f = ff(this, function () {
			var g = f.group();

			for (var key in data) {
				if (this.indexes[table][key]) {
					// make sure no results
					var q = {};
					q[key] = data[key];
					this.read(table, q, {}, g());
				}
			}
		}, function (check) {
			// make sure no results were found
			for (var i = 0; i < check.length; ++i) {
				if (check[i] && check[i].length) {
					f.fail([{message: "Unique constraint violation"}])
				}
			}

			this.connection.save(
				this.bucket, 
				getKey(table, data._id), // generate key
				JSON.stringify(data), // stringify the data
				{index: data}, // turn all data keys into 2i
				f.slot()
			);
		}, function (results) {
			console.log("Write", results)
			f.pass(results);
		}).cb(next)
	},

	modify: function (table, conditions, data, next) {
		var f = ff(this, function () {
			this.read(table, conditions, {}, f.slot());
		}, function (results) {
			var g = f.group();

			for (var i = 0; i < results.length; ++i) {
				for (var key in data) {
					results[i][key] = data[key];
				}

				this.write(table, results[i], g())
			}
		}).cb(next);
	},

	remove: function (table, conditions, next) {
		var f = ff(this, function () {
			this.read(table, conditions, {}, f.slot());
		}, function (results) {
			var g = f.group();

			for (var i = 0; i < results.length; ++i) {
				this.connection.remove(
					this.bucket,
					getKey(table, results[i]._id),
					g()
				);
			}
		}).cb(next);
	},

	increment: function (table, conditions, data, next) {
		var f = ff(this, function () {
			this.read(table, conditions, {}, f.slot());
		}, function (results) {
			var g = f.group();

			for (var i = 0; i < results.length; ++i) {
				for (var key in data) {
					results[i][key] = results[i][key] + data[key];
				}

				this.write(table, results[i], g())
			}
		}).cb(next);
	}
});

module.exports = Riak;
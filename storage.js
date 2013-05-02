var pg = require("pg");
var ff = require("ff");

var conString = "pg://louis:@localhost/sproute";

function Storage (app) {
	this.app = app;
}

/**
* Create the thing/data structure for
* the app.
*/
Storage.prototype.initDatabase = function (next) {
	ff(function () {
		Storage.query("CREATE TABLE IF NOT EXISTS $1 (thing unsigned integer, thingKey text, thingValue text) PRIMARY KEY (thingID, thingKey)", [
			this.app + "-data"
		], this.slot());	
	}).cb(next);
};

/**
* Get all rows from a thing.
*/
Storage.prototype.getRows = function (table, next) {
	ff(function () {
		Storage.query("SELECT * FROM $1 WHERE thing = $2", [
			this.app + "-data",
			table
		], this.slot());
	}).cb(next);
}

/**
* Get a row for a thing
*/
Storage.prototype.getRow = function (table, field, value, next) {
	ff(function () {
		Storage.query("SELECT * FROM $1 WHERE thing = $2 AND $3 = $4", [
			this.app + "-data",
			table,
			field,
			value
		], this.slot());
	}).cb(next);
}

/**
* Add a row
*/
Storage.prototype.addRow = function (table, attrs, next) {
	var app = this.app;

	ff(function () {
		var sql = "INSERT INTO $1 VALUES ";
		var insql = [];
		var idx = 2;
		var data = [app + "-data"];

		for (var field in attrs) {
			data.push(table);
			data.push(field);
			data.push(attrs[field]);

			insql.push("($" + (idx++) + ", $" + (idx++) + ", $" + (idx++) + ")");
		}

		sql += insql.join(",");
		console.log(sql, data, table, attrs)

		Storage.query(sql, data, this.slot());
	}).cb(next);
}

//create a wrapper query method to handle
//pooled connections.
Storage.query = function (query, args, cb) {
    pg.connect(conString, function (err, client, done) {
        client.query(query, args, function () {
        	cb && cb.apply(client, arguments);
        	done();
        });
    });
};

Storage.init = function (app) {
	return new Storage(app);
}

module.exports = Storage;
var riak = require("riak-js");
var ff = require("ff");
var path = require("path");

var db;
var bucket;

function getKey (p) {
	return "fs:" + p.split("/").join(":");
}

exports.init = function (opts) {
	bucket = opts.name;
	db = riak.getClient();
};

exports.readFile = function (file, next) {
	db.get(bucket, getKey(file), {}, function (err, item) {
		if (err) next([{message: "Could not find file `" + file + "`."}]);
		else next(null, item);
	});
};

exports.writeFile = function (file, body, next) {
	var name = path.basename(file);
	var dir = path.dirname(file);

	ff(function () {
		exports.exists(file, this.slotPlain());
	}, function (exists) {
		if (!exists) {
			var f = ff(function () {
				exports.readdir(dir, f.slot());	
			}, function (dirs) {
				if (!Array.isArray(dirs)) {
					dirs = [];
				}

				dirs.push(name);
				db.save(bucket, getKey(dir), dirs, f.slot());
			}).cb(this.slot())
		}
	}, function () {
		db.save(bucket, getKey(file), body, {}, this.slot());	
	}).cb(next);
};

exports.exists = function (file, next) {
	db.get(bucket, getKey(file), {}, function (err, item) {
		next(!err);
	});	
};

exports.unlink = function (file, next) {
	var name = path.basename(file);
	var dir = path.dirname(file);

	ff(function () {
		exports.readdir(dir, this.slot());
	}, function (dirs) {
		var idx = dirs.indexOf(name)
		if (idx != -1) {
			dirs.splice(idx, 1);
			db.save(bucket, getKey(dir), dirs);
		}

		db.remove(bucket, getKey(file), this.slot());
	}).cb(next);
};

exports.readdir = function (file, next) {
	console.log(bucket, file, getKey(file))
	db.get(bucket, getKey(file), {}, function (err, item) {
		if (err) next(null, []);
		else next(null, item);
	});
};

exports.readdirRecursive = function (file, next) {

};

exports.mkdir = function (file, next) {
	var name = path.basename(file);
	var dir = path.dirname(file);

	ff(function () {
		exports.readdir(dir, this.slot());
	}, function (dirs) {
		var idx = dirs.indexOf(name)
		if (idx == -1) {
			dirs.push(name);
			db.save(bucket, getKey(dir), dirs);
		}
	}, function () {
		db.save(bucket, getKey(file), [], next);	
	}).cb(next);
};

exports.rmdir = function (file, next) {
	var name = path.basename(file);
	var dir = path.dirname(file);

	ff(function () {
		exports.readdir(dir, this.slot());
	}, function (dirs) {
		var idx = dirs.indexOf(name)
		if (idx != -1) {
			dirs.splice(idx, 1);
			db.save(bucket, getKey(dir), dirs);
		}
	}, function () {
		db.remove(bucket, getKey(file), next);
	}).cb(next);	
};
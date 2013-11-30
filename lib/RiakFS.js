var riak = require("riak-js");
var ff = require("ff");

var db;
var bucket;

function getKey (p) {
	return "fs:" + p.split("/").join(":");
}

exports.init = function (opts) {
	bucket = opts.name;
	db = riak.getClient();
};

exports.readFile = function (path, next) {
	db.read(bucket, getKey(path), {}, next);
};

exports.writeFile = function (path, body, next) {
	db.save(bucket, getKey(path), body, next);
};

exports.exists = function (path, next) {
	db.read(bucket, getKey(path), {}, function (err) {
		next(!err);
	});	
};

exports.unlink = function (path, next) {
	db.remove(bucket, getKey(path), next);
};

exports.readdir = function (path, next) {

};
var storage = require("./storage").init("myblog");
var _ = require("underscore");

storage.onready = function () {
	this.get("data/posts", function (err, q) {
		console.log("QUERY", q)
	})
};

var storage = require("./storage").init("hello");

storage.initDatabase();

storage.addRow("post", {
	title: "fuck"
}, function () {
	console.log("WHAT AM I DOING", arguments);
});

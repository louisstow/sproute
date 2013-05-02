var greenhouse = require("./index");
var fs = require("fs");

var template = fs.readFileSync("./templ.html").toString();
var data = {
	home: true,
	html: "<strong>Dont let a day go by</strong>",
	nest: true,
	list: [
		{type: "Page", text: "<b>I</b> am paralised"},
		{type: "Image", text: "http://google.com/logo.png"},
		{type: "Quote", quote: "Fuck", source: "Louis Stowasser"}
	]
};

console.log( greenhouse.render(template, data) );


var greenhouse = require("./greenhouse");
var fs = require("fs");

var template = fs.readFileSync("./templ.html").toString();
var data = {
	home: true,
	yo: "Dont let a day go by",
	nest: true,
	list: [
		"I am paralised",
		"so afraid to die",
		"Tension strikes, worries grow"
	]
};

console.log( greenhouse.render(template, data) );


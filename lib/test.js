var greenhouse = require("./greenhouse");
var fs = require("fs");

var template = fs.readFileSync("./templ.html").toString();
var data = {
	home: true,
	yo: "Dont let a day go by"
};

console.log( greenhouse.render(template, data) );


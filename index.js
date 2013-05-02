//import npm modules
var express = require("express");
var app = express();
var ff = require("ff");
var fs = require("fs");
var path = require("path");
var _ = require("underscore");

//import local modules
var appName = "myblog";
var storage = require("./storage").init(appName);
var greenhouse = require("./greenhouse");

require("./config/express")(app);

var dir = "example";
var controller;
var config;

var viewCache = {};

try {
	controller = require("./" + dir + "/controller");
} catch (e) {
	console.error("Controller at path: [" +  + "] not found.");
	console.error(e);
}

try {
	config = JSON.parse(fs.readFileSync(path.join(dir, "config")));
} catch (e) {
	console.error("Error loading config");
	console.error(e);
}

for (var route in controller) {
	var view = controller[route];
	
	//closure to keep the vars
	(function (route, view) {
		var viewPath = path.join(dir, config.views, view + "." + config.extension);

		ff(function () {
			//check the view template exists
			fs.exists(viewPath, this.slotPlain());
		}, function (viewExists) {
			//if the view doesn't exist, fail
			if (!viewExists) {
				return this.fail("View template does not exists at: " + viewPath);
			}

			//read the contents of the template
			fs.readFile(viewPath, this.slot());
		}, function (template) {
			//cache the view
			viewCache[view] = template.toString();
		}).error(function (e) {
			console.error("Error loading the view template.", "[" + viewPath + "]")
			console.error(e);
		});

		//handle the route
		app.get(route, function (req, res) {
			console.log("GET", route, view, req.params, req.query);
			
			//grab the template from the cache
			var template = viewCache[view];
			var data = {};

			//build the data to pass into template
			_.extend(data, {
				params: req.params, 
				query: req.query
			});

			//render and send it back to client
			var compiled = greenhouse.render(template, data)
			res.send(compiled);
		});
	})(route, view);
	
}

console.log("CONTROLER", controller)

app.listen(8089);
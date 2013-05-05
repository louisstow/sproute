var path = require("path");
var ff = require("ff");
var fs = require("fs");
var _ = require("underscore");

var Storage = require("./storage");
var Greenhouse = require("./greenhouse");

function App (name, dir, server) {
	this.name = name;
	this.dir = dir;
	this.server = server;
	this._viewCache = {};

	this.loadConfig();
	this.loadController();
	this.loadModel();

	this.loadHook();

	for (var route in this.controller) {
		this.initRoute(route, this.controller[route]);
	}
}

App.prototype = {
	/*
	* Load the configuration data. Must exist in a file
	* called "config" and be valid JSON.
	*/
	loadConfig: function () {
		try {
			this.config = JSON.parse(fs.readFileSync(path.join(this.dir, ".config")));
		} catch (e) {
			console.error("Error loading config");
			console.error(e);

			this.config = {
				"models": "models",
				"views": "views",
				"controller": "controller",
				"extension": "sprt"
			};
		}

	},

	/**
	* Load the controller JSON file.
	*/
	loadController: function () {
		try {
			this.controller = JSON.parse(fs.readFileSync(path.join(this.dir, this.config.controller)));
		} catch (e) {
			console.error("Controller at path: [" +  + "] not found.");
			console.error(e);
		}
	},

	loadModel: function () {
		var modelPath = path.join(this.dir, this.config.models);
		var files = fs.readdirSync(modelPath);
		var structure = {};

		for (var i = 0; i < files.length; ++i) {
			var file = files[i];
			var table = file.split(".")[0];
			structure[table] = JSON.parse(fs.readFileSync(path.join(modelPath, file)).toString());
		}

		this.storage = new Storage(this.name, structure);
	},

	initRoute: function (route, view) {

		var viewPath = path.join(this.dir, this.config.views, view + "." + this.config.extension);

		var f = ff(this, function () {
			//check the view template exists
			fs.exists(viewPath, f.slotPlain());
		}, function (viewExists) {
			//if the view doesn't exist, fail
			if (!viewExists) {
				return f.fail("View template does not exists at: " + viewPath);
			}

			//read the contents of the template
			fs.readFile(viewPath, f.slot());
		}, function (template) {
			//cache the view
			this._viewCache[view] = template.toString();
		}).error(function (e) {
			console.error("Error loading the view template.", "[" + viewPath + "]")
			console.error(e);
		});

		//handle the route
		var self = this;
		this.server.get(route, function (req, res) {
			console.log("GET", route, view, req.params, req.query);
			
			//grab the template from the cache
			var template = self._viewCache[view];
			var data = {};

			//build the data to pass into template
			_.extend(data, {
				params: req.params, 
				query: req.query
			});

			//render and send it back to client
			var g = new Greenhouse();
			g.oncompiled = function (html) {
				res.send(html);
			};

			g.render(template, data, self.hooks);
		});
	},

	loadHook: function () {
		var app = this;
		this.hooks = {
			get: function (block) {
				//pause parsing and decode request
				this.pause();
				var expr = block.expr.split(" ");
				var key = expr[2];
				var url = expr[0];

				//request the data then continue parsing
				app.storage.get(url, function (err, data) {
					console.log(url, data, key)
					this.data[key] = data;
					this.resume();
				}.bind(this));
			}
		};
	}
};

module.exports = App;
var path = require("path");
var ff = require("ff");
var fs = require("fs");
var _ = require("underscore");
var express = require("express");
var mathjs = require("mathjs");

var Storage = require("./storage");
var Greenhouse = require("./greenhouse");

function App (name, dir, server) {
	this.name = name;
	this.dir = dir;
	
	this._viewCache = {};

	this.loadConfig();
	this.server = this.loadServer();

	this.loadController();
	this.loadModel();

	this.loadHook();

	for (var route in this.controller) {
		this.initRoute(route, this.controller[route]);
	}

	this.loadREST();
}

App.prototype = {
	/*
	* Load the configuration data. Must exist in a file
	* called "config" and be valid JSON.
	*/
	loadConfig: function () {
		this.config = {
			"models": "models",
			"views": "views",
			"controller": "controller.json",
			"extension": "sprt",
			"secret": this.name.toUpperCase(),
			"static": "public",
			"cacheViews": false
		};

		try {
			var c = JSON.parse(fs.readFileSync(path.join(this.dir, "config.json")));
			_.extend(this.config, c);
		} catch (e) {
			console.error("Error loading config");
			console.error(e, e.stack);
		}

	},

	loadServer: function () {
		var server = express();
		var secret = this.config.secret || (this.config.secret = (Math.random() * 10000000 | 0).toString(16));

	    server.use(express.cookieParser(secret));
	    server.use(express.session({secret: secret, cookie: {maxAge: null}}));

	    var staticDir = path.join(this.dir, this.config.static);
	    console.log(this.config.static, staticDir)
	    server.use("/" + this.config.static, express.static(staticDir, { maxAge: 1 }));
	    server.use(express.bodyParser());

	    this.config.port = this.config.port || 8089;
	    server.listen(this.config.port);
	    return server;
	},

	/**
	* Load the controller JSON file.
	*/
	loadController: function () {
		try {
			console.log(this.config, this.dir)
			this.controller = JSON.parse(fs.readFileSync(path.join(this.dir, this.config.controller)));
		} catch (e) {
			console.error("Controller at path: [" +  + "] not found.");
			console.error(e);
			console.error(e.stack);
		}
	},

	/**
	* Load the model structures and initialise
	* the storage instance for this app.
	*/
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

	loadView: function (view, next) {
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
			f.pass(this._viewCache[view])
		}).error(function (e) {
			console.error("Error loading the view template.", "[" + viewPath + "]")
			console.error(e);
		}).cb(next);
	},

	/**
	* Setup the routes from the controller. Handle
	* the requests and start an instance of the greenhouse
	* template parser.
	*/
	initRoute: function (route, view) {
		this.loadView(view);
		
		//handle the route
		var self = this;
		this.server.get(route, function (req, res) {
			console.log("GET", route, view, req.params, req.query);
			var data = {};
			//build the data to pass into template
			_.extend(data, {
				params: req.params, 
				query: req.query,
				session: req.session,
				self: {
					dir: path.join(self.dir, self.config.views),
					url: req.url
				}
			});

			var f = ff(self, function () {
				//grab the template from the cache
				if (this.config.cacheViews) {
					f.pass(this._viewCache[view]);
				} else {
					this.loadView(view, f.slot());
				}
			}, function (template) {
				//render and send it back to client
				var g = new Greenhouse(this.hooks);
				g.oncompiled = function (html) {
					res.send(html);
				};

				g.onerror = function (error) {
					res.json(error);
				}

				g.render(template, data);
			});
		});
	},

	/**
	* Setup hooks into the template parser to
	* return data from the storage engine.
	*/
	loadHook: function () {
		var app = this;
		this.hooks = {
			get: function (block, next) {
				//pause parsing and decode request
				var expr = block.expr.split(" ");
				var key = expr[2];
				var url = expr[0];
				console.log("hook get", expr, key, url)
				//request the data then continue parsing
				app.storage.get({url: url}, function (err, data) {
					console.log("get cmd", url, data, key)
					this.data[key] = data;
					next();
				}.bind(this));
			},

			expr: function (block, next) {
				var expr = this.parseExpression(block.rawExpr, function (n) {
					return parseInt(n, 10) || 0;
				});

				var result = 0;

				console.log("MATH EXPR", expr);
				try {
					result = mathjs.eval(expr).toString();
				} catch (e) {
					result = "Error";
				}

				this.pieces.push(result);
				this.start = block.end + 1;
				next();
			}
		};
	},

	/**
	* User the server 
	*/
	loadREST: function () {
		this.server.get("/data/*", this.handleGET.bind(this));
		this.server.post("/data/*", this.handlePOST.bind(this));
		this.server.delete("/data/*", this.handleDELETE.bind(this));

		this.server.get("/api/logged", this.getLogged.bind(this));
		this.server.post("/api/login", this.login.bind(this));
		this.server.post("/api/logout", this.logout.bind(this));
	},

	handleGET: function (req, res) {
		this.storage.get(req, function (err, response) {
			if (err) {
				console.error("Error in storage method", req.url, "GET");
				console.error(err);
			}
			res.json(response);
		});
	},

	handlePOST: function (req, res) {
		console.log("BODY", req.body)
		this.storage.post(req, req.body, function (err, response) {
			if (err) {
				console.error("Error in storage method", req.url, "POST");
				console.error(err);
			}

			if (req.query.goto) {
				res.redirect(req.query.goto);
			}

			res.json(response);
		});
	},

	handleDELETE: function (req, res) {
		this.storage.delete(req.url, function (err, response) {
			if (err) {
				console.error("Error in storage method", req.url, "DELETE");
				console.error(err);
			}

			if (req.query.goto) {
				res.redirect(req.query.goto);
			}

			res.json(response);
		});
	},

	getLogged: function (req, res) {
		if (req.session && req.session.user) {
			res.json(req.session.user); 
		} else {
			res.json(false);
		}
	},

	login: function (req, res) {
		this.storage.get("/data/users/name/" + req.body.name, function (err, data) {
			console.log("err", data);
			if (err || !data.length) {
				return res.json({error: "User not found"});
			}

			var user = data[0];
			if (user.pass === req.body.pass) {
				req.session.user = _.extend({}, user);
				delete req.session.user.pass;
				res.json(req.session.user);
			} else {
				res.json({error: "Username and password mismatch"})
			}

			if (req.query.goto) {
				res.redirect(req.query.goto);
			}
		});
	},

	logout: function (req, res) {
		req.session.destroy();
		req.session = null;

		if (req.query.goto) {
			res.redirect(req.query.goto);
		} else {
			res.send(200);
		}
	},

	hashPassword: function (pass) {
		var hash = crypto.createHash("sha256");
		hash.update(pass);
		return hash.digest("hex");
	}
};

module.exports = App;
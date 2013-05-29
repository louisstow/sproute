var path = require("path");
var ff = require("ff");
var fs = require("fs");
var _ = require("underscore");
var express = require("express");
var mathjs = require("mathjs");
var pwd = require("pwd");

var Storage = require("./storage");
var Greenhouse = require("./greenhouse");

function randString () {
	return Math.random().toString(36).substr(2);
}

function App (dir) {
	this.dir = dir;
	
	this._viewCache = {};

	this.loadConfig();
	this.server = this.loadServer();

	this.loadModel();
	this.loadPermissions();
	this.loadController();

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
			"secret": randString(),
			"static": "public",
			"cacheViews": false,
			"port": 8000
		};

		try {
			var c = JSON.parse(fs.readFileSync(path.join(this.dir, "config.json")));
			_.extend(this.config, c);
		} catch (e) {
			console.error("Error loading config");
			console.error(e, e.stack);
		}

		if (!this.config.name) {
			console.error("You must include a `name` parameter in your config.json file");
			process.exit(1);
		}

		this.name = this.config.name;
	},

	/**
	* Configure the Express server from
	* the config data.
	*/
	loadServer: function () {
		var server = express();
		var secret = this.config.secret || (this.config.secret = (Math.random() * 10000000 | 0).toString(16));

	    server.use(express.cookieParser(secret));
	    server.use(express.session({secret: secret, cookie: {maxAge: null}}));

	    var staticDir = path.join(this.dir, this.config.static);
	    console.log(this.config.static, staticDir)
	    server.use("/" + this.config.static, express.static(staticDir, { maxAge: 1 }));
	    server.use(express.bodyParser());
	    server.use(express.csrf());

	    var self = this;
	    server.use(function (err, req, res, next) {
	    	if (err) {
	    		self.errorHandler(req, res).call(self, err);
	    	} else next();
	    });

	    this.config.port = this.config.port || 8089;
	    server.listen(this.config.port);
	    return server;
	},

	/**
	* Load the controller JSON file.
	*/
	loadController: function () {
		var controllerPath = path.join(this.dir, this.config.controller);

		try {
			console.log(this.config, this.dir)
			this.controller = JSON.parse(fs.readFileSync(controllerPath));
		} catch (e) {
			console.error("Controller at path: [" + controllerPath + "] not found.");
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
		if (!fs.existsSync(modelPath)) {
			return;
		}

		var files = fs.readdirSync(modelPath);
		var structure = {};

		for (var i = 0; i < files.length; ++i) {
			var file = files[i];
			var table = file.split(".")[0];
			structure[table] = JSON.parse(fs.readFileSync(path.join(modelPath, file)).toString());
		}

		this.storage = new Storage({
			name: this.name, 
			structure: structure,
			config: this.config
		});
	},

	/**
	* Load the permissions table and implement
	* some server middleware to validate the
	* permission before passing to the next
	* route handler.
	*/
	loadPermissions: function () {
		var permissionsPath = path.join(this.dir, "permissions.json");

		try {
			this.permissions = JSON.parse(fs.readFileSync(permissionsPath));
		} catch (e) {
			console.error("permissions at path: [" + permissionsPath + "] not found.");
			console.error(e);
			console.error(e.stack);
		}

		for (var url in this.permissions) {
			var parts = url.split(" ");
			var method = parts[0].toLowerCase();
			var route = parts[1];
			var user = this.permissions[url];

			//more closures
			(function (method, route, user) {
				var self = this;

				this.server[method](route, function (req, res, next) {
					console.log("PERMISSION", method, route, user);
					var flag = false;

					//save the required permission and pass it on
					req.permission = user;

					//stranger must NOT be logged in
					if (user === "stranger") {
						if (req.session && req.session.user) {
							flag = true;
						}
					}
					//member or owner must be logged in
					//owner is handled further in the process
					else if (user === "member" || user === "owner") {
						if (!req.session.user) {
							flag = true;
						}
					}
					//no restriction
					else if (user === "anyone") {
						flag = false;
					}
					//custom roles
					else {
						var role = req.session.user && req.session.user.role || "stranger";
						flag = !self.storage.inheritRole(role, user);
					}

					if (flag) {
						return res.json({error: "You do not have permission to complete this action."})
					} else next();
				});
			}).call(this, method, route, user)
			
		}
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

	renderView: function (view, data, req, res) {
		//build the data to pass into template
		_.extend(data, {
			params: req.params, 
			query: req.query,
			session: req.session,
			self: {
				dir: path.join(this.dir, this.config.views),
				url: req.url
			}
		});

		var f = ff(this, function () {
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
		}).error(function () {
			res.send(404);
		});
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
			self.renderView(view, {}, req, res);
		});
	},

	testRoute: function (method, url) {
		var routes = this.server.routes[method];

		for (var i = 0; i < routes.length; ++i) {
			//see if this route matches
			if (routes[i].regexp.test(url)) {
				var permissionKey = method.toUpperCase() + " " + routes[i].path;
				var userType = this.permissions[permissionKey];

				//return the first matching type
				if (userType) {
					return userType
				}
			}
		}

		//default to anyone
		return "anyone";
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
				
				//see if this url has a permission associated
				var permission = app.testRoute("get", url);

				//request the data then continue parsing
				app.storage.get({url: url, permission: permission}, function (err, data) {
					this.data[key] = data;
					next();
				}.bind(this));
			},

			expr: function (block, next) {
				var expr = this.parseExpression(block.rawExpr, function (n) {
					return parseInt(n, 10) || 0;
				});

				var result = "0";
				try {
					result = mathjs.eval(expr).toString();
				} catch (e) {
					result = "[MathError]";
				}

				this.pieces.push(result);
				this.start = block.end + 1;
				next();
			}
		};
	},

	/**
	* Setup the endpoints for the REST interface
	* to the model.
	*/
	loadREST: function () {
		//don't use the default REST api for creating a user
		this.server.post(/\/data\/users\/?$/, this.register.bind(this));

		//rest endpoints
		this.server.get("/data/*", this.handleGET.bind(this));
		this.server.post("/data/*", this.handlePOST.bind(this));
		this.server.delete("/data/*", this.handleDELETE.bind(this));

		//api endpoints
		this.server.get("/api/logged", this.getLogged.bind(this));
		this.server.post("/api/login", this.login.bind(this));
		this.server.post("/api/logout", this.logout.bind(this));
		this.server.post("/api/register", this.register.bind(this));
	},

	/**
	* REST handlers
	*/
	handleGET: function (req, res) {
		//forward the request to storage
		this.storage.get(req, this.response(req, res));
	},

	handlePOST: function (req, res) {
		//forward the post data to storage
		this.storage.post(req, req.body, this.response(req, res));
	},

	handleDELETE: function (req, res) {
		this.storage.delete(req, this.response(req, res));
	},

	/**
	* In-built user account functionality.
	*/
	getLogged: function (req, res) {
		if (req.session && req.session.user) {
			res.json(req.session.user); 
		} else {
			res.json(false);
		}
	},

	login: function (req, res) {
		var url = "/data/users/name/" + req.body.name;
		var permission = this.testRoute("get", url);

		var f = ff(this, function () {
			this.storage.get({url: url, permission: permission}, f.slot());
		}, function (data) {
			//no user found, throw error
			if (!data.length) { f.fail({error: "No username found."}); }

			var user = data[0];
			f.pass(user);
			pwd.hash(req.body.pass, user._salt, f.slot());
		}, function (user, pass) {
			console.log("WTF", user, pass)
			if (user.pass === pass.toString("base64")) {
				req.session.user = _.extend({}, user);
				delete req.session.user.pass;
				delete req.session.user._salt;
				res.json(req.session.user);
			} else {
				res.json({error: "Username and password mismatch"})
			}

			if (req.query.goto) {
				res.redirect(req.query.goto);
			}
		}).error(this.errorHandler(req, res));
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

	/**
	* Must go through the /api/register endpoint
	* If logged in, can only create a role equal to or less than current
	* If not, cannot specify role
	*/
	register: function (req, res) {
		var url = "/data/users/";

		if (req.session.user) {
			if (req.body.role && !this.storage.inheritRole(req.session.user.role, req.body.role)) {
				return res.json({error: "Cannot create that role"});
			}
		} else {
			if (req.body.role) {
				return res.json({error: "Cannot create that role"});
			}
		}

		//for some reason FF doesnt work with pwd...
		var self = this;
		pwd.hash(req.body.pass.toString(), function (err, salt, hash) {
			req.body._salt = salt;
			req.body.pass = hash;
			console.log("PASS", req.body.pass)

			self.storage.post({url: url}, req.body, self.response(req, res));
		});
	},

	/**
	* Create a callback function handle a response
	* from the storage instance.
	*/
	response: function (req, res) {
		var self = this;
		return function (err, response) {
			if (err) {
				return self.errorHandler(req, res).call(self, err);
			}

			if (req.query.goto) {
				res.redirect(req.query.goto);
			}

			res.json(response);
		}
	},

	/**
	* Create an error handler function
	*/
	errorHandler: function (req, res) {
		var self = this;
		return function (err) {
			//log to the server
			console.error("-----------");
			console.error("Error occured during %s %s", req.method.toUpperCase(), req.url)
			console.error(err);
			console.error("-----------");

			if (self.config.errorView) {
				self.renderView.call(self, self.config.errorView, {
					error: err
				}, req, res);
			} else res.json(err)
		}
	}
};

module.exports = App;

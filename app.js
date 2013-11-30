var path = require("path");
var util = require("util");
var ff = require("ff");
var fs = require("fs");
var _ = require("underscore");
var express = require("express");
var mathjs = require("mathjs");
var toobusy = require('toobusy');
var nodemailer = require('nodemailer');
var recaptcha = require('simple-recaptcha');

var Storage = require("./storage");
var Greenhouse = require("./greenhouse");
var Error = require("./lib/Error");
var pwd = require("./lib/Hash");

function randString () {
	return ("00000000" + Math.random().toString(36).substr(2)).substr(-11);
}

var ERROR_CODE = 500;

function App (dir, opts) {
	console.log("APP", dir, opts)
	this.dir = path.resolve(dir);
	opts = opts || {};
	this.opts = opts;
	
	this._viewCache = {};
	this._remoteAddrs = {};
	this._sockets = [];

	var f = ff(this, function () {
		this.loadConfig(f.slot());
	}, function () {
		if (opts.loadServer !== false) {
			this.loadServer(opts, f.slot());
		}
	}, function () {
		if (opts.loadModel !== false)
			this.loadModel(f.slot());
	}, function () {
		if (opts.loadPermissions !== false)
			this.loadPermissions(f.slot());
	}, function () {
		if (opts.loadController !== false)
			this.loadController(f.slot());
	}, function () {
		if (opts.loadViews !== false)
			this.loadHook(f.slot());
	}, function () {
		if (opts.loadViews !== false) {
			if (this.config.showAdmin) {
				this.initRoute("/admin", path.join(__dirname, "ui/views/dashboard"));
				this.initRoute("/admin/login", path.join(__dirname, "ui/views/login"));
			}

			for (var route in this.controller) {
				this.initRoute(route, path.join(this.dir, this.config.views, this.controller[route]));
			}
		}
	
		if (opts.loadController !== false)
			this.loadREST(f.slot());
	}, function () {
		if (opts.loadMailer !== false)
			this.loadMailer(f.slot());
	}, function () {
		if (this.config.showAdmin) {
			require("./ui/admin").init(this);
		}

		this._restarting = false;
	}).error(function (err) {
		console.error("Error in Sproute");
		console.error(err);
		console.error(err.stack);
		process.exit(1);
	});
}

App.prototype = {
	/*
	* Load the configuration data. Must exist in a file
	* called "config" and be valid JSON.
	*/
	loadConfig: function (next) {
		this.config = {
			"models": "models",
			"views": "views",
			"controller": "controller.json",
			"extension": "sprt",
			"secret": randString(),
			"static": "public",
			"cacheViews": false,
			"showError": true,
			"showAdmin": true,
			"strict": false,
			"db": {
				"type": "Mongo"
			},
			"mailer": {
				"type": "sendmail"
			},
			"port": 8000,
			"csrf": false,
			"rateLimit": 10,
			"reCAPTCHA": false
		};

		var f = ff(this, function () {
			fs.readFile(path.join(this.dir, "config.json"), f.slot())
		}, function (file) {
			try {
				var c = JSON.parse(file.toString());
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
		}).cb(next);
	},

	/**
	* Configure the Express server from
	* the config data.
	*/
	loadServer: function (opts, next) {

		var server;
		var secret = this.config.secret || (this.config.secret = (Math.random() * 10000000 | 0).toString(16));
		var self = this;

		if (opts.reload) {
			server = this.server;
			server.routes = {'get': [], 'post': [], 'delete': []};
			server._router.map = {};
		} else {
			server = express();
		}

		// gracefully handle many requests
		if (this.config.strict) {
			toobusy.maxLag(200);
			server.use(function(req, res, next) {
				if (toobusy()) res.json(503, [{message: "I'm busy right now, sorry."}]);
				else next();
			});

			// rate limit
			server.use(function (req, res, next) {
				if (req.method.toLowerCase() !== "post") { return next(); }

				var ip = req.headers['x-real-ip'] || req.ip;
				if (!ip || ip == "127.0.0.1") { return next(); }

				// currently blocked
				if (self._remoteAddrs[ip] === true) {
					return res.json(420, [{message: "Enhance your calm, bro. Sending too many requests from `"+ip+"`."}])
				}

				self._remoteAddrs[ip] = true;
				setTimeout(function () {
					delete self._remoteAddrs[ip];
				}, self.config.rateLimit * 1000);

				next();
			});
		}

	    server.use(express.cookieParser(secret));
	    server.use(express.session({secret: secret, cookie: {maxAge: null}}));

		if (this.config.static !== false) {
			var staticDir = path.join(this.dir, this.config.static);
			server.use("/" + this.config.static, express.static(staticDir, { maxAge: 1 }));
		}

	    server.use(express.bodyParser());
	    
	    //use the anti-CSRF middle-ware if enabled
	    if (this.config.csrf) {
	    	server.use(express.csrf());
	    }

	    if (this.config.showAdmin) {
	    	var staticDir = path.join(__dirname, "ui/assets");
	    	server.use("/admin/assets/", express.static(staticDir, { maxAge: 1 }));
	    }

	    // global error handler
	    server.use(function (err, req, res, next) {
	    	if (err) {
	    		this.errorHandler(req, res).call(this, err);
	    	} else next();
	    }.bind(this));

	    // listen could be handled outside
	    if (opts.listen !== false) {
		    server.http = server.listen(this.config.port);

		    server.http.on("connection", function (sock) {
		    	this._sockets.push(sock);
		    }.bind(this));

		    server.http.on("close", function (sock) {
		    	var idx = this._sockets.indexOf(sock);
		    	if (idx !== -1) {
		    		this._sockets.splice(idx, 1);
		    	}
		    }.bind(this));
		}

		this.server = server;
		next();
	},

	/**
	* Load the controller JSON file.
	*/
	loadController: function (next) {
		var controllerPath = path.join(this.dir, this.config.controller);

		var f = ff(this, function () {
			fs.readFile(controllerPath, f.slot());
		}, function (file) {
			try {
				this.controller = JSON.parse(file.toString());
			} catch (e) {
				console.error("Controller at path: `" + controllerPath + "` not found.");
				process.exit(1);
			}
		}).cb(next);
	},

	/**
	* Load the model structures and initialise
	* the storage instance for this app.
	*/
	loadModel: function (next) {
		var modelPath = path.join(this.dir, this.config.models);
		var structure = {};

		// models are not mandatory so warn in the log
		var f = ff(this, function () {
			fs.exists(modelPath, f.slotPlain());
		}, function (exists) {
			if (!exists) {
				console.warn("Models at path `" + modelPath + "` does not exist")
				return;
			}

			fs.readdir(modelPath, f.slot());
		}, function (files) {
			
			f.pass(files);
			var g = f.group();

			for (var i = 0; i < files.length; ++i) {
				var file = files[i];
				var table = file.split(".")[0];

				if (!table) { continue; }

				fs.readFile(path.join(modelPath, file), g());
			}

		}, function (files, contents) {
			for (var i = 0; i < files.length; ++i) {
				var file = files[i].toString();
				var table = file.split(".")[0];

				if (table == "") {
					files.splice(i--, 1);
					continue; 
				}

				try {
					console.log(table)
					structure[table] = JSON.parse(contents[i].toString());
				} catch (e) {
					console.error("Error parsing model `%s`", table);
					process.exit(1);
				}
			}
		
			var storage = new Storage({
				name: this.name, 
				schema: structure,
				config: this.config,
				dir: this.dir
			});

			this.structure = structure;
			this.storage = storage;
		}).cb(next);
	},

	/**
	* Load the permissions table and implement
	* some server middleware to validate the
	* permission before passing to the next
	* route handler.
	*/
	loadPermissions: function (next) {
		var permissionsPath = path.join(this.dir, "permissions.json");

		var f = ff(this, function () {
			fs.readFile(permissionsPath, f.slot())
		}, function (perms) {
			try {
				this.permissions = JSON.parse(perms);
			} catch (e) {
				console.error("permissions at path: [" + permissionsPath + "] not found.");
				console.error(e);
				console.error(e.stack);
			}

			//loop over the urls in permissions
			Object.keys(this.permissions).forEach(function (url) {
				var parts = url.split(" ");
				var method = parts[0].toLowerCase();
				var route = parts[1];
				var user = this.permissions[url];

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
						return res.json(ERROR_CODE, [{message: "You do not have permission to complete this action."}])
					} else next();
				});
				
			}.bind(this));
		}).cb(next);
	},

	loadView: function (view, next) {
		var viewPath = path.resolve(view + "." + this.config.extension);

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

	renderView: function (view, data, req, res, next) {
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
			};

			g.onredirect = function (url) {
				res.redirect(url);
			};

			g.render(template, data);
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
					return userType;
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
	loadHook: function (next) {
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
					console.log("GET", url, data);
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
			},

			debug: function (block, next) {
				var value = this.extractDots(block.rawExpr);
				console.log("DEBUG", value, this.data);
				this.pieces.push(JSON.stringify(value));
				this.start = block.end + 1;
				next();
			},

			redirect: function (block, next) {
				this.onredirect && this.onredirect.call(this, block.expr);
				return false;
			}
		};

		//scan plugins directory
		var pluginPath = path.join(__dirname, "plugins");
		var f = ff(this, function () {
			fs.exists(pluginPath, f.slotPlain());
		}, function (exists) {
			if (!exists) {
				return this.succeed();
			}

			fs.readdir(pluginPath, f.slot());
		}, function (files) {
			for (var i = 0; i < files.length; ++i) {
				var file = files[i];
				var table = file.split(".")[0];

				//require the JS file
				var hooks = require(path.join(pluginPath, file));
				console.log("LOAD HOOK", path.join(pluginPath, file), Object.keys(hooks))
				//extend the main hook object
				_.extend(this.hooks, hooks);
			}
		}).cb(next);
	},

	/**
	* Setup the endpoints for the REST interface
	* to the model.
	*/
	loadREST: function (next) {
		//don't use the default REST api for creating a user
		this.server.post(/\/data\/users\/?$/, this.register.bind(this));

		//rest endpoints
		this.server.get("/data/*", this.handleGET.bind(this));
		this.server.post("/data/*", this.handlePOST.bind(this));
		this.server.delete("/data/*", this.handleDELETE.bind(this));

		//api endpoints
		this.server.get("/api/logged", this.getLogged.bind(this));
		this.server.post("/api/login", this.login.bind(this));
		this.server.post("/api/update", this.update.bind(this));
		this.server.post("/api/forgot", this.forgot.bind(this));
		this.server.get("/api/logout", this.logout.bind(this));
		this.server.get("/api/recover", this.recover.bind(this));
		this.server.post("/api/register", this.register.bind(this));

		next();
	},

	loadMailer: function (next) {
		this.mailer = nodemailer.createTransport(
			this.config.mailer.type,
			"/usr/sbin/sendmail"
		);

		next()
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
		this.storage.post(req, this.response(req, res));
	},

	handleDELETE: function (req, res) {
		this.storage.delete(req, this.response(req, res));
	},

	/**
	* In-built user account functionality.
	*/
	getLogged: function (req, res) {
		if (req.session && req.session.user) {

			if (req.query.reload) {
				// reload the user object
				this.storage.get({
					url: "/data/users/_id/" + req.session.user._id + "/?single=true",
					session: req.session
				}, function (err, user) {
					req.session.user = _.extend({}, user);
					delete req.session.user.pass;
					delete req.session.user._salt;
					res.json(req.session.user);
				});
			} else {
				res.json(req.session.user); 
			}
		} else {
			res.json(false);
		}
	},

	login: function (req, res) {
		var url = "/data/users/name/" + req.body.name;
		var permission = this.testRoute("get", url);

		var f = ff(this, function () {
			this.storage.db.read("users", {name: req.body.name}, {}, f.slot());
		}, function (data) {
			console.log("LOGIN", data, req.body.name)
			//no user found, throw error
			if (!data.length) { 
				return f.fail("No username `"+req.body.name+"` found."); 
			}

			if (!req.body.pass) {
				return f.fail("No password specified."); 
			}

			var user = data[0];
			f.pass(user);
			pwd.hash(req.body.pass || "", user._salt, f.slot());
		}, function (user, pass) {
			if (user.pass === pass.toString("base64")) {
				req.session.user = _.extend({}, user);
				delete req.session.user.pass;
				delete req.session.user._salt;
				res.json(req.session.user);
			} else {
				return f.fail("Username and password mismatch."); 
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
		req.url = "/data/users/";

		var err = [];

		if (req.session.user) {
			if (req.body.role && !this.storage.inheritRole(req.session.user.role, req.body.role)) {
				err.push({message: "Do not have permission to create the role `"+req.body.role+"`."})
			}
		} else {
			if (req.body.role) {
				err.push({message: "Do not have permission to create the role `"+req.body.role+"`."})
			}
		}

		if (!req.body.name) {
			err.push({message: "No user provided"});
		}

		if (!req.body.pass) {
			err.push({message: "No password provided"});
		}

		if (err.length) { return res.json(ERROR_CODE, err); }

		var f = ff(this, function () {
			if (this.config.reCAPTCHA !== false) {
				var challenge = req.body.recaptcha_challenge_field;
	  			var response = req.body.recaptcha_response_field;
	  			console.log(req.body)
				recaptcha(this.config.reCAPTCHA, req.ip, challenge, response, f.wait());
			}
		}, function () {
			pwd.hash(req.body.pass.toString(), f.slot());
		}, function (hash) {
			//add these fields after validation
			req.body._salt = hash[0];
			req.body.pass = hash[1];

			var cb = this.response(req, res);
			this.storage.post(req, function (err, data) {
				if (data) { 
					data = data[0]; 

					delete data.pass;
					delete data._salt;
				}

				cb(err, data);
			});
		}).error(this.errorHandler(req, res));
	},

	update: function (req, res) {
		var err = [];

		if (!req.session || !req.session.user) {
			err.push({message: "Must be logged in"});
		}

		if (!req.body.pass) {
			err.push({message: "No password provided"});
		}

		if (err.length) { return res.json(ERROR_CODE, err); }

		var user = req.session.user;

		var f = ff(this, function () {
			this.storage.get({
				url: "/data/users/_id/" + req.session.user._id + "/?single=true",
				session: req.session
			}, f.slot());
		}, function (user) {
			f.pass(user);
			pwd.hash(req.body.pass, user._salt, f.slot());
		}, function (user, pass) {
			// valid password, update details
			if (user.pass === pass.toString("base64")) {
				delete req.body.pass;

				// handle new passwords
				if (req.body.newpass) {
					pwd.hash(req.body.newpass, f.slot());
					delete req.body.newpass;
				}
			} else {
				f.fail({message: "Incorrect password"});
			}
		}, function (hash) {
			if (hash) {
				req.body._salt = hash[0];
				req.body.pass = hash[1];
			}

			this.storage.post({
				url: "/data/users/_id/" + user._id,
				body: req.body,
				session: req.session
			}, f.slot());
		}, function () {
			res.json("ok");
		}).error(this.errorHandler(req, res));
	},

	forgot: function (req, res) {
		var f = ff(this, function () {
			this.storage.get({
				url: "/data/users/name/" + req.body.name + "/?single=true"
			}, f.slot());
		}, function (user) {
			// only allow sending authkey once every 2 hours
			if (user.authkey) {
				var key = parseInt(user.authkey.substring(0, user.authkey.length - 11), 16);
				var diff = key - Date.now();

				if (diff > 0) {
					var hours = diff / 60 / 60 / 1000;
					return f.fail([{message: "Must wait " + hours.toFixed(1) + " hours before sending another recovery email."}]);
				}
			}

			// make sure key is > Date.now()
			var key = (Date.now() + 2 * 60 * 60 * 1000).toString(16);
			key += randString(); // a touch of randomness

			this.storage.post({
				url: "/data/users/name/" + req.body.name,
				body: {authkey: key},
				session: App.adminSession
			});

			console.log("BEFORE MAIL");
			this.mailer.sendMail({
			 	from: this.config.mailer.from,
				to: user.name,
				subject: "Recover Pixenomics Password",
				text: "You have received this email because you forgot your password. If you did not forget, simply ignore this email. Click the following link to reset the password. The link will expire within 2 hours.\n\nhttp://pixenomics.com/api/recover?auth=" + key
			}, f.slot());
		}).error(this.errorHandler(req, res));
	},

	recover: function (req, res) {
		if (!req.query.auth) {
			return res.json(ERROR_CODE, [{message: "No authkey provided."}])
		}

		// could be very invalid keys
		var key = req.query.auth;
		key = parseInt(key.substring(0, key.length - 11), 16);

		var diff = key - Date.now();

		// key has expired
		if (isNaN(diff) || diff <= 0) {
			return res.json(ERROR_CODE, [{message: "Auth token provided has expired. Send another recovery email."}])
		}

		var newpass = randString();

		var f = ff(this, function () {
			pwd.hash(newpass, f.slot());

			this.storage.get({
				url: "/data/users/authkey/" + req.query.auth + "/?single=true",
				session: App.adminSession
			}, f.slot());
		}, function (hash, user) {
			if (!user) {
				return f.fail([{message: "Cannot find user with that authkey."}])
			}

			// update the new password and clear the key
			this.storage.post({
				url: "/data/users/_id/" + user._id,
				body: {pass: hash[1], _salt: hash[0], authkey: ""},
				session: App.adminSession
			}, f.slot());
		}, function () {
			this.renderView(
				path.join(this.config.views, "forgot"), 
				{newpass: newpass}, req, res
			);
		}).error(this.errorHandler(req, res));
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
			// do not show code in strict mode
			if (self.config.strict) {
				if (err.stack) delete err.stack;
			}

			var error = new Error(err);

			//log to the server
			console.error("-----------");
			console.error("Error occured during %s %s", req.method && req.method.toUpperCase(), req.url)
			if (self.config.showError) {
				console.error(err);
				if (err.stack) console.error(err.stack);
			}
			console.error("-----------");

			// render the error view
			if (self.config.errorView) {
				self.renderView.call(self, 
					path.join(this.config.views, self.config.errorView), 
					{error: error.template}, 
					req, res,
					function (err) {
						// in case of error in error
						if (err) {
							res.json(ERROR_CODE, error.template)
						}
					}
				);
			} else res.json(ERROR_CODE, error.template)
		}
	},

	reload: function () {
		console.log("\n\n**** RESTARTING ****\n\n");

		this._restarting = true;		
		this.opts.listen = false;
		this.opts.reload = true;
		App.call(this, this.dir, this.opts);
	}
};

App.adminSession = {
	user: { role: "admin" }
};

module.exports = App;

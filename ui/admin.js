var fs = require("fs");
var ff = require("ff");
var path = require("path");

var allowedKeys = [
	'name',
	'controller',
	'models',
	'views',
	'extension',
	'static',
	'strict',
	'cacheViews',
	'showError',
	'errorView',
	'csrf',
	'reCAPTCHA',
	'rateLimit'
];

if (!fs.readdirRecursive) {
	fs.readdirRecursive = function (dir, next) {
		var f = ff(this, function () {
			fs.readdir(dir, f.slot());
		}, function (files) {
			f.pass(files);
			var group = f.group();

			for (var i = 0; i < files.length; ++i) {
				if (files[i].indexOf(".") == -1) {
					// wtf
					//group()(null, files[i]);
					fs.readdir(path.join(dir, files[i]), group());
				}
			}
		}, function (files, subfiles) {
			// move subfiles into files
			var j = 0;
			for (var i = 0; i < files.length; ++i) {
				if (files[i].indexOf(".") == -1) {
					files = files.concat(subfiles[j++].map(function (x) {
						return files[i] + '/' + x;
					}));
				}
			}

			f.pass(files);
		}).cb(next);
	};
}

var Admin = {
	init: function (app) {
		this.setupRoutes(app);
	},

	setupRoutes: function (app) {
		app.server.get("/admin/*", function (req, res, next) {
			if (!req.session || !req.session.user || req.session.user.role != "admin") {
				return res.json(500, [{message: "You must be admin"}]);
			}

			next();
		});

		app.server.get("/admin/views", function (req, res) {
			var f = ff(this, function () {
				fs.readdirRecursive(path.join(app.dir, app.config.views), f.slot())
			}, function (dirs) {
				//remove directories from list
				for (var i = 0; i < dirs.length; ++i) {
					if (dirs[i].indexOf(".") == -1) {
						dirs.splice(i--, 1);
					}
				}

				res.json(dirs);
			});
		});

		app.server.post("/admin/template", function (req, res) {
			var name = req.body.name;
			var templatePath = path.join(app.dir, app.config.views, name);

			var f = ff(this, function () {
				fs.exists(templatePath, f.slotPlain());
			}, function (exists) {
				if (exists) {
					return f.fail([{error: "Template already exists."}]);
				}

				fs.mkdir(templatePath, f.slot());
			}, function () {
				fs.writeFile(path.join(templatePath, "header.sprt"), "", f.waitPlain());
				fs.writeFile(path.join(templatePath, "footer.sprt"), "", f.waitPlain());
			}, function () {
				res.json("ok");
			}).error(function (err) {
				res.json(500, err);
			});
		});

		app.server.delete("/admin/template", function (req, res) {
			var name = req.body.name;
			var templatePath = path.join(app.dir, app.config.views, name);

			var f = ff(this, function () {
				fs.exists(templatePath, f.slotPlain());
			}, function (exists) {
				if (!exists) {
					return f.fail();
				}

				fs.unlink(path.join(templatePath, "header.sprt"), f.waitPlain());
				fs.unlink(path.join(templatePath, "footer.sprt"), f.waitPlain());
			}, function () {
				fs.rmdir(templatePath, f.slot())
			}, function () {
				res.json("ok");
			}).error(function (err) {
				res.json(500, err);
			});
		});

		app.server.get("/admin/views/:name", function (req, res) {
			ff(function () {
				var p = path.join(app.dir, app.config.views, req.params.name + ".sprt")
				fs.readFile(p, this.slot());
			}).cb(function (err, content) {
				res.json(content.toString());
			});
		});

		app.server.get("/admin/structure", function (req, res) {
			res.json(app.structure)
		});

		app.server.get("/admin/controller", function (req, res) {
			res.json(app.controller)
		});

		app.server.get("/admin/config", function (req, res) {
			var hash = {};
			for (var i = 0; i < allowedKeys.length; ++i) {
				hash[allowedKeys[i]] = app.config[allowedKeys[i]];
			}

			res.json(hash)
		});

		app.server.get("/admin/permissions", function (req, res) {
			res.json(app.permissions)
		});

		app.server.post("/admin/views", function (req, res) {
			console.log(app.dir, app.config.views, req.body.name + ".sprt")
			var p = path.join(app.dir, app.config.views, req.body.name + ".sprt");
			
			fs.writeFile(p, req.body.content, function () {
				res.json("ok");
				app.reload();	
			});
		});

		app.server.delete("/admin/views/:name", function (req, res) {
			var name = req.params.name;
			if (name == "header" || name == "footer") {
				return res.send(500);
			}

			var p = path.join(app.dir, app.config.views, name + "." + app.config.extension);
			fs.unlink(p);

			res.json("ok");
			app.reload();
		});

		app.server.post("/admin/models", function (req, res) {
			var d = req.body.content;
			if (!d) {
				d = {};
			}

			var name = req.body.name;
			if (!name) {
				return res.send(500);
			}

			console.log(d)
			app.structure[name] = d;

			var p = path.join(app.dir, app.config.models, req.body.name + ".json");
			fs.writeFile(p, JSON.stringify(d, null, '\t'), function () {
				res.json("ok");
				app.reload();
			});
		});

		app.server.delete("/admin/models/:name", function (req, res) {
			var name = req.params.name;
			if (name == "users") {
				return res.send(500);
			}

			var p = path.join(app.dir, app.config.models, name + ".json");
			fs.unlink(p);
			delete app.structure[name];

			res.json("ok");
			app.reload();
		});

		app.server.post("/admin/config", function (req, res) {
			var c = req.body;
			for (var key in c) {
				if (allowedKeys.indexOf(key) == -1) {
					console.error("Illegal key", key)
					continue;
				}

				app.config[key] = c[key];
			}

			fs.writeFile(path.join(app.dir, "config.json"), JSON.stringify(app.config, null, '\t'), function () {
				res.json("ok");
				app.reload();	
			});
		});

		app.server.post("/admin/permissions", function (req, res) {
			var c = req.body;
			for (var key in c) {
				app.permissions[key] = c[key];
			}

			fs.writeFile(path.join(app.dir, "permissions.json"), JSON.stringify(app.permissions, null, '\t'), function () {
				res.json("ok");
				app.reload();	
			});
		});

		app.server.delete("/admin/permissions", function (req, res) {
			var c = req.body;
			console.log(c)
			delete app.permissions[c.route];
			
			fs.writeFile(path.join(app.dir, "permissions.json"), JSON.stringify(app.permissions, null, '\t'), function () {
				res.json("ok");
				app.reload();	
			});
		});

		app.server.post("/admin/controller", function (req, res) {
			var c = req.body;
			for (var key in c) {
				app.controller[key] = c[key];
			}

			fs.writeFile(path.join(app.dir, "controller.json"), JSON.stringify(app.controller, null, '\t'), function () {
				res.json("ok");
				app.reload();				
			});
		});

		app.server.delete("/admin/controller", function (req, res) {
			var c = req.body;
			console.log(c)
			delete app.controller[c.route];
			
			fs.writeFile(path.join(app.dir, "controller.json"), JSON.stringify(app.controller, null, '\t'), function () {
				res.json("ok");
				app.reload();				
			});
		});
	}
};

module.exports = Admin;
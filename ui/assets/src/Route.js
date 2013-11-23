var RouteController = Spineless.View.extend({
	template: [
		{id: "routeList"},
		{tag: "label", children: [
			{tag: "span", text: "Template: "},
			{tag: "input", id: "route"}
		]},

		{tag: "label", children: [
			{tag: "span", text: "Page: "},
			{tag: "select", id: "view"}
		]},

		{tag: "button", id: "submit", text: "Add Route"}
	],

	events: {
		"click submit": "onSubmit"
	},

	defaults: {
		"view": "",
		"route": ""
	},

	init: function () {
		RouteController.super(this, "init", arguments);

		var id = this.sync("get", "/admin/views");
		this.once(id, function (views) {
			console.log(views)
			//this.template
			for (var i = 0; i < views.length; ++i) {
				views[i] = views[i].substring(0, views[i].lastIndexOf(".sprt"))

				this.view.appendChild(Spineless.View.toDOM({
					tag: "option",
					value: views[i],
					text: views[i]
				}));
			}

			this.views = views;

			var id = this.sync("get", "/admin/controller");
			this.once(id, function (resp) {
				for (var key in resp) {
					var n = resp[key];
					console.log(n, resp[key])

					this.addChild(new Route({
						superview: this.routeList,
						route: key,
						name: n,
						views: views
					}))
				}
			});
		});
	},

	onSubmit: function () {
		var d = {};
		d[this.model.route] = this.model.view;

		this.post("/admin/controller", d);
		this.once("sync:post", function () {
			if (this.find({route: this.model.route}).length) {
				return;
			}

			this.addChild(new Route({
				superview: this.routeList,
				route: this.model.route,
				name: this.model.view,
				views: this.views
			}));
		});
	}
});

var Route = Spineless.View.extend({
	template: [
		{tag: "span", id: "route"},
		{tag: "select", id: "name"},
		{tag: "button", id: "cancel", text: "X"}
	],

	defaults: {
		"route": "",
		"name": ""
	},

	events: {
		"click cancel": "onCancel"
	},

	onCancel: function () {
		this.delete("/admin/controller", {route: this.model.route})
		this.once("sync:delete", function () {
			console.log("DELETE")
		});
	},

	init: function (opts) {
		Route.super(this, "init", arguments);

		for (var i = 0; i < opts.views.length; ++i) {
			this.name.appendChild(Spineless.View.toDOM({
				tag: "option",
				value: opts.views[i],
				text: opts.views[i]
			}));
		}

		this.set("name", opts.name);
		this.on("change", function (name, val) {
			var d = {};
			d[this.model.route] = val;
			this.post("/admin/controller", d);
		});
	},

	render: function () {
		this.route.textContent = this.model.route;
	}
});

$(".route").click(function () {
	if (p) {
		p.removeFromParent();
	}

	p = new RouteController({
		superview: "page"
	});	
})
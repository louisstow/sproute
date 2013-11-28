
var ConfigController = Spineless.View.extend({
	template: [
		{tag: "label", children: [
			{tag: "span", text: "App Name: "},
			{tag: "input", id: "name"}
		]},

		{tag: "label", children: [
			{tag: "span", text: "Controller File: "},
			{tag: "input", id: "controller"}
		]},

		{tag: "label", children: [
			{tag: "span", text: "Model Directory: "},
			{tag: "input", id: "models"}
		]},

		{tag: "label", children: [
			{tag: "span", text: "View Directory: "},
			{tag: "input", id: "views"}
		]},

		{tag: "label", children: [
			{tag: "span", text: "View Extension: "},
			{tag: "input", id: "extension"}
		]},

		{tag: "label", children: [
			{tag: "span", text: "Public Directory: "},
			{tag: "input", id: "static"}
		]},

		{tag: "label", children: [
			{tag: "span", text: "Strict Mode: "},
			{tag: "input", type: "checkbox", id: "strict"},
			{tag: "span", className: "hint", text: "Recommended in production environments"}
		]},

		{tag: "label", children: [
			{tag: "span", text: "Cache Views: "},
			{tag: "input", type: "checkbox", id: "cacheViews"}
		]},

		{tag: "label", children: [
			{tag: "span", text: "Show Errors: "},
			{tag: "input", type: "checkbox", id: "showError"}
		]},

		{tag: "label", children: [
			{tag: "span", text: "Error View: "},
			{tag: "select", id: "errorView", children: [
				{tag: "option", value: "", text: "None"}
			]}
		]},

		{tag: "label", children: [
			{tag: "span", text: "Anti CSRF: "},
			{tag: "input", type: "checkbox", id: "csrf"},
			{tag: "span", className: "hint", text: "Every form requires a CSRF key"}
		]},

		{tag: "label", children: [
			{tag: "span", text: "reCAPTCHA: "},
			{tag: "input", id: "reCAPTCHA"}
		]},

		{tag: "label", children: [
			{tag: "span", text: "Rate Limit: "},
			{tag: "input", id: "rateLimit"},
			{tag: "span", className: "hint", text: "Seconds between throttling requests per IP"}
		]},

		{tag: "button", text: "Update Config", id: "submit"}
	],

	events: {
		"click submit": "onSubmit"
	},

	init: function (opts) {
		ConfigController.super(this, "init", arguments);

		var id = this.sync("get", "/admin/config");
		this.once(id, function (config) {
			this.config = config;
			this.set(config);
		});

		var id = this.sync("get", "/admin/views");
		this.once(id, function (views) {
			for (var i = 0; i < views.length; ++i) {
				var name = views[i].substring(0, views[i].lastIndexOf("."));

				this.errorView.appendChild(Spineless.View.toDOM({
					tag: "option",
					value: name,
					text: name
				}))
			}

			if (this.config.errorView) {
				this.set("errorView", this.config.errorView)
			}
		});
	},

	onSubmit: function () {
		console.log(this.model);
		this.post("/admin/config");
	}
});

$(".config").click(function () {
	if (p) {
		p.removeFromParent();
	}

	p = new ConfigController({
		superview: "page"
	});	
})
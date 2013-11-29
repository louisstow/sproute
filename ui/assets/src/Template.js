var TemplateController = Spineless.View.extend({
	template: [
		{id: "templateList"},

		{className: "create", children: [
			{tag: "label", children: [
				{tag: "span", text: "Name: "},
				{tag: "input", id: "name"}
			]},

			{tag: "button", text: "Create Template", id: "submit"}
		]}
	],

	defaults: {
		"name": ""
	},

	events: {
		"click submit": "onSubmit"
	},

	init: function (opts) {
		TemplateController.super(this, "init", arguments);

		this.sync("get", "/admin/views");
		this.once("sync:get", function (resp) {
			var templates = {};
			for (var i = 0; i < resp.length; ++i) {
				if (resp[i].indexOf("/") != -1) {
					var name = resp[i].split("/")[0];
					templates[name] = 1;
				}
			}

			for (var name in templates) {
				this.addChild(new Template({
					superview: this.templateList,
					name: name
				}));
			}
		});
	},

	onSubmit: function () {
		this.post("/admin/template", {name: this.model.name});
		this.once("sync:post", function () {
			this.addChild(new Template({
				superview: this.templateList,
				name: this.model.name
			}));
		});
	}
});

var Template = Spineless.View.extend({
	template: [
		{id: "name"},
		{tag: "button", text: "X", id: "remove"}
	],

	defaults: {
		"name": ""
	},

	events: {
		"click remove": "onRemove"
	},

	onRemove: function () {
		this.delete("/admin/template", {name: this.model.name});
		this.once("sync:delete", this.removeFromParent);
	},

	render: function () {
		this.name.textContent = this.model.name;
	}
});

$(".template").click(function () {
	if (p) {
		p.removeFromParent();
	}

	p = new TemplateController({
		superview: "page"
	});	
})
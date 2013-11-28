var PageController = Spineless.View.extend({
	template: [
		{className: "new", children: [
			{tag: "label", children: [
				{tag: "span", text: "Page Name: "},
				{tag: "input", id: "name"}
			]},

			{tag: "label", children: [
				{tag: "textarea", id: "content"}
			]},

			{tag: "button", id: "submit", type: "submit", text: "Create Page"}
		]},
		{id: "list"}
	],

	events: {
		"click submit": "onSubmit"
	},

	defaults: {
		"name": "",
		"content": ""
	},

	init: function () {
		Page.super(this, "init", arguments);

		this.sync("get", "/admin/views");
		this.once("sync:get", this.onViews);

		this.on("selected", this.onSelect);
	},

	onViews: function (views) {
		for (var i = 0; i < views.length; ++i) {
			var n = views[i].substring(0, views[i].lastIndexOf("."))
			this.addChild(new Page({
				superview: this.list,
				name: n
			}));
		}
	},

	onSubmit: function () {
		this.post("/admin/views");
		this.once("sync:post", function (resp) {
			console.log("POST", this.model.name)
			
			//exists already
			console.log(this.find({name: this.model.name}), this.model.name)
			if (this.find({name: this.model.name}).length) {
				return;
			}

			this.addChild(new Page({
				superview: this.list,
				name: this.model.name
			}));
		});
	},

	onSelect: function (view) {
		var id = this.sync("get", "/admin/views/" + view);
		this.set("name", view);

		this.on("sync:" + id, function (resp) {
			this.set("content", resp)
		});
	}
});

var Page = Spineless.View.extend({
	defaults: {
		name: ""
	},

	template: [
		{id: "name"},
		{id: "cancel", tag: "button", text: "X"}
	],

	events: {
		"click name": "onClick",
		"click cancel": "onCancel"
	},

	onClick: function () {
		this.emit("selected", this.model.name);
	},

	onCancel: function () {
		var id = this.delete("/admin/views/" + this.model.name);
		this.once(id, this.removeFromParent);
	},

	render: function () {
		this.name.textContent = this.model.name;
	}
});

$(".page").click(function () {
	if (p) {
		p.removeFromParent();
	}

	p = new PageController({
		superview: "page"
	});	
})


var entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': '&quot;',
    "'": '&#39;',
    "/": '&#x2F;'
};

var spaceRx = /\s+/;
var _slice = Array.prototype.slice;

function escapeHtml (string) {
    if (string === null || string === undefined) {
        return string;
    }

    return String(string).replace(/[&<>"'\/]/g, function (s) {
        return entityMap[s];
    });
}

exports.toJSON = function (adt) {
    return JSON.stringify(adt, null, '\t');
}

//global compiled variable
//due to easier recursion handling
var compiled = "";
exports.compileErrors = [];
exports.isError = false;

/**
* Parse template char by char
* look for {
    * parse the expression
    * save the inner html
    * save the start and end char points in template
* look for }
*/
exports.render = function (template, data) {
    compiled = "";
    exports.compileErrors.length = 0;

    //tokenize and set error flag
    var tokens = tokenize(template);
    exports.isError = !!exports.compileErrors.length;
    
    if (exports.isError) {
        console.log(exports.compileErrors);
        return;
    }

    link(template, tokens, data, 0);

    return pieces.join("");
}

var types = {
    "VAR": "var",
    "CONDITION": "condition",
    "LOOP": "loop"
};

function getLineFromIndex (template, index) {
    var prevLineBreak = template.lastIndexOf("\n", index) + 1;
    var nextLineBreak = template.indexOf("\n", index);
    
    var lines = template.split("\n");
    var line = template.substring(prevLineBreak, nextLineBreak);
    var num = 0;

    for (var i = 0; i < lines.length; ++i) {
        if (lines[i] == line) {
            num = i + 1;
            break;
        }
    }

    console.log(num + ":|" + line);
}

/**
* [
    {type: "condition", start: 6, end: 20, t: [], f: []}
* ]
*/
function tokenize (template) {
    //flags to keep track of
    //open expressions
    var openTag = -1;
    var openCondition = []; //stack
    var openLoop = []; //stack

    var tokens = [];
    var parent = tokens;

    //loop over every fucking character :\
    for (var idx = 0; idx < template.length; ++idx) {
        var char = template[idx];

        //open tag
        if (char === '{') {
            //already open
            if (openTag !== -1) {
                exports.compileErrors.push("Tag already opened at `" + openTag + "`");
                getLineFromIndex(template, openTag);
                return;
            }

            openTag = idx;
        }

        //closedTag
        if (char === '}') {
            if (openTag === -1) {
                exports.compileErrors.push("Tag not opened at" + idx);
                getLineFromIndex(template, idx);
                return;
            }

            //grab the expression from last open tag
            var expression = template.substring(openTag + 1, idx).trim();

            var token =  {};
            parent.push(token);

            //a conditional statement
            if (expression.substr(0, 2).toLowerCase() === "if") {
                token.type = types.CONDITION;
                token.expr = expression.substr(3);
                token.startTrue = idx + 1;
                token.start = openTag;
                
                var ifOptions = token.expr.split(spaceRx);
                token.thing = ifOptions[0];
                token.operator = (ifOptions[1] || "eq").toLowerCase();

                //merge every split term into one string value
                //e.g. "This", "is", "a", "string" => "This is a string"
                if (ifOptions.length > 3) {
                    token.value = ifOptions.slice(2).join(" ");
                } else {
                    //otherwise just take the value
                    //and default to true
                    token.value = ifOptions[2] || true;
                }

                //nested template blocks
                token.onTrue = [];
                token.onFalse = [];

                //push the current condition
                //on the stack
                openCondition.push(token);
                token.parent = parent;

                //subsequent blocks fall under this
                parent = token.onTrue;
            }
            //an else statement
            else if (expression.toLowerCase() === "else") {
                token.skipFrom = openTag;
                token.skipTo = idx + 1;
                token.type = "else";
                var lastCondition = openCondition.pop();
                
                //save pointers to the start and end
                //of the else
                lastCondition.endTrue = openTag;
                lastCondition.startFalse = idx + 1;
                lastCondition.else = true;

                parent = lastCondition.onFalse;
                openCondition.push(lastCondition);
            }
            //loop
            else if (expression.substr(0, 4).toLowerCase() === "each") {
                token.type = types.LOOP;
                token.startLoop = idx + 1;
                token.start = openTag;
                token.loop = [];

                //parse the loop expression
                var eachOptions = expression.substr(5).split(/[\s,]+/);
                token.list = eachOptions[0];
                token.iterator = eachOptions[2];
                if (eachOptions.length === 4) { 
                    token.index = eachOptions[3]; 
                }

                openCondition.push(token);
                token.parent = parent;
                parent = token.loop;
            }
            //close the last expression
            else if (expression[0] === '/') {
                //skip the entire tag
                token.skipFrom = openTag;
                token.skipTo = idx + 1;

                //need to swap the parent
                //to the parent of the last condition
                var lastCondition = openCondition.pop();

                //save a pointer to the end of condition
                if (lastCondition.else) { lastCondition.endFalse = idx + 1; }
                else { lastCondition.endTrue = idx + 1; }

                parent = lastCondition.parent;
                delete lastCondition.parent;
            }
            //placeholder
            else {
                token.type = types.VAR;
                token.start = openTag + 1;
                token.end = idx;
                token.placeholder = expression;
            }

            //reset open tag flag
            openTag = -1;
        }
    }

    if (openTag !== -1) {
        exports.compileErrors.push("Tag not closed at " + openTag);
        getLineFromIndex(template, openTag);
        return;
    }

    return tokens;
}

/**
* 1. Compile to `compiled`
* 2. When rendering placeholder... do something
* 3. 
*/
var pieces = [];

function extractDots (line, data) {
    if (line.indexOf(".") === -1) {
        return data[line];
    }

    return line.split('.').reduce(
        function (obj, i) {
            return obj && obj[i];
        },

        data
    );
}

function link (template, adt, data, start) {
    var originalStart = start;

    for (var i = 0; i < adt.length; ++i) {
        var block = adt[i];

        //skip if an empty block
        if (block.skipFrom) {
            pieces.push(template.substring(start, block.skipFrom));
            start = block.skipTo;
            continue; 
        }

        switch (block.type) {

            /**
            * {<var>}
            */
            case types.VAR: 
                var placeholder = block.placeholder;
                var escape = true;

                //trim the hash and don't escape
                if (placeholder[0] === "#") {
                    placeholder = placeholder.substr(1);
                    escape = false;
                }

                var value = extractDots(placeholder, data);
                if (escape) { value = escapeHtml(value); }
            
                pieces.push(template.substring(start, block.start - 1))
                if (value) { pieces.push(value); }

                start = block.end + 1;

                break;
            
            /**
            * {if: <var> <operator> <value>}
            */
            case types.CONDITION:
                pieces.push(template.substring(start, block.start));

                var result = false;

                
                var thing = extractDots(block.thing, data);
                var operator = block.operator;
                var value = block.value;

                switch (operator) {
                    case "=":
                    case "==":
                    case "eq":
                        result = (thing == value);
                        break;

                    case "<>":
                    case "!=":
                    case "neq":
                        result = (thing != value);
                        break;

                    case ">":
                    case "gt":
                        result = (thing > value);
                        break;

                    case "<":
                    case "lt":
                        result = (thing < value);
                        break;

                    case ">=":
                    case "gte":
                        result = (thing >= value);
                        break;

                    case "<=":
                    case "lte":
                        result = (thing <= value);
                        break;
                }

                //if the expressions evaluates to
                //true, execute the onTrue blocks
                if (result) {
                    if (block.onTrue) {
                        link(template, block.onTrue, data, block.startTrue);
                    }
                } else {
                    if (block.onFalse && block.else) {
                        link(template, block.onFalse, data, block.startFalse);
                    }
                }

                if (block.else) { start = block.endFalse; }
                else { start = block.endTrue; }

                break;

            /**
            * {each <list> as <item>[, <index>]}
            */
            case types.LOOP:
                pieces.push(template.substring(start, block.start));

                var list = data[block.list] || [];

                for (var j = 0; j < list.length; ++j) {
                    data[block.iterator] = list[j];
                    data[block.index] = j;

                    link(template, block.loop, data, block.startLoop);
                }

                start = block.endTrue;

                break;
        }
    }

    //add the last of the template if this was the
    //original link call
    if (originalStart === 0) {
        pieces.push(template.substring(start, template.length));
    }
    
}

exports.tokenize = tokenize;
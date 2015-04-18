var marked = require('marked');
var sqlite3 = require('sqlite3');
var express = require('express');
var session = require('express-session');
var override = require('method-override');
var bodyParser = require('body-parser');
var MongoStore = require('connect-mongo')(session);
var mustache = require('mustache');
var fs = require('fs');

var formcss;
fs.readFile("./public/formcss.css", function(err,data) {
  if (err) throw(err);
  formcss = data.toString();
});


// ***********************************   initialization stuff   ***********************************

var db = new sqlite3.Database('wiki.db');

var app = express();
app.use(override('_method'));

app.use(session({
  store: new MongoStore({
    host: '127.0.0.1',
      port: 27017,
      db: "wiki"
  }),
  secret: 'a fancy secret',
  resave: false,
  saveUninitialized: true,
  cookie: {
    maxAge: 600000
  }
}));

app.use(bodyParser.urlencoded({
  extended: false
}));


// *********************************** users routes ***********************************

app.get("/users/new", function (req,res) {
  res.render("users/edit.ejs", {formaction: "/users", user: req.session.user, css: formcss, title: ""});
});

app.get("/users/login", function (req,res) {
  res.render("users/login.ejs", {css: formcss, title: ""});
});

app.post("/users/login", function (req,res) {
  ensureUser(req);
  req.session.user.username = req.body.username;
  res.redirect(req.session.user.curpage);
});

app.get("/users/logout", function (req,res) {
  ensureUser(req);
  req.session.user.username = "guest";
  res.redirect(req.session.user.curpage);
});

app.post("/users", function (req,res) {
  ensureUser(req);
  req.session.user.username = req.body.username;
  res.redirect(req.session.user.curpage);
  // res.redirect(req.session.curpage);
});

// currently only replaces [[title]] with the markdown version [title](title)
function replaceKeywords(text) {
  text = text.replace(/\[\[(.*?)\]\]/g, "[$1]($1)");
  return text;
}


// *********************************** doc reading routes ***********************************

// retrieve index of docs
app.get("/", function (req,res) {
  res.redirect("doc/main");
});

app.get("/docs", function (req,res) {
  res.redirect("doc/main");
  // db.all("SELECT title,docs.docid,docs.version FROM docs JOIN versionedDocs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version", function(err,data) {
  //   if (err) throw(err);
  //   ensureUser(req);
  //   req.session.user.curpage = req.originalUrl;
  //   res.render("docs/index.ejs",{docs: data, user: req.session.user});
  // });
});


// retrieve doc by title
app.get("/doc/:title", function (req,res) {
  db.get( "SELECT title,body,html,css,numpanes FROM"+
          " versionedDocs"+
          " JOIN docs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version"+
          " JOIN layouts ON versionedDocs.layout = layouts.name"+
          " WHERE title = ?",
    req.params.title,
    function(err,data) {
      if (err) throw(err);
      if (typeof data === 'undefined') {
        res.send(req.params.title + " not found.");
      } else {
        ensureUser(req);
        req.session.user.curpage = req.originalUrl;
        parseTagsInArray(JSON.parse(data.body), keywords, function(arr) {
          var contents = {title: req.params.title};
          for (var i=0; i<arr.length; i++) {
            contents["content"+i] = marked(arr[i]);
          }
          // console.log(mustache.render(data['html'],contents));
          res.render("docs/show.ejs",{
            title: data.title,
            content: mustache.render(data.html,contents),
            css:data.css,
            user: req.session.user});
        });
        // res.render("docs/show.ejs",{title: data.title, body: marked(parseTags(data.body, keywords)), user: req.session.user});
      }
    });
});


// *********************************** doc edit routes ***********************************

// retrieve new doc form. uses same form as editpage
app.get("/docs/new", function (req,res) {
  db.all("SELECT name,numpanes FROM layouts", function (err,data) {
    if (err) throw(err);
    res.render("docs/edit.ejs", {
      formaction: "/docs",
      docid:0,
      title: "untitled",
      body: '[""]',
      layoutname: data[0].name,
      numpanes: data[0].numpanes,
      user: req.session.user,
      layouts: data,
      css: formcss
    });
  });
});

// retrieve edit page for doc
app.get("/doc/:title/edit", function (req,res) {
  db.get( "SELECT title,body,docs.docid,numpanes,name "+
          "FROM versionedDocs "+
          "JOIN docs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version "+
          "JOIN layouts ON versionedDocs.layout = layouts.name "+
          "WHERE title = ?",
    req.params.title,
    function(err,data) {
      if (err) throw(err);
      if (typeof data === "undefined") {
        res.send(req.params.title + " not found.");
      } else {
        db.all("SELECT name,numpanes FROM layouts", function(err,layouts) {
          ensureUser(req);
          req.session.user.curpage = req.originalUrl;
          res.render("docs/edit.ejs",{
            formaction: "/doc/"+data.docid,
            docid: data.docid,
            title: data.title,
            body: data.body,
            layoutname: data.name,
            numpanes: data.numpanes,
            user: req.session.user,
            layouts: layouts,
            css: formcss});
        });
      }
    });
});

// update doc docid.
app.post("/doc/:docid", function (req,res) {
  db.get("SELECT max(version),title FROM versionedDocs WHERE docid = ?", req.params.docid, function (err,data) {
    if (err) throw(err);
    if (typeof data === "undefined") { // maybe create a new entry here.
      res.send("oops! couldn't find the doc to update");
    } else {
      version = data["max(version)"] + 1;
      // console.log(req.body);
      var content=[];
      for (var i=0; i<req.body.numpanes; i++) {
        content.push(req.body["content"+i]);
      }
      ensureUser(req);
      if (data.title === "main") req.body.title = data.title; // disable renaming the main page
      db.run("INSERT INTO versionedDocs (docid,title,layout,body,version,userid,changed) VALUES (?,?,?,?,?,?,strftime('%s','now'))",
        req.params.docid, req.body.title, req.body.layout, JSON.stringify(content), version, req.session.user.username,
        function (err) {
          if (err) throw(err);
          db.run("UPDATE docs SET version = ? WHERE docid = ?", version, req.params.docid, function (err) {
            if (err) throw(err);
            res.redirect("/doc/"+req.body.title);
          });
        });
    }
  });
});

// add new doc
app.post("/docs", function (req,res) {
  db.run("INSERT INTO docs (version) VALUES (1)", function (err) {
    if (err) throw(err);
    db.run("INSERT INTO versionedDocs (docid, title, body, version, userid, changed) VALUES (?,?,?,?,?,strftime('%s','now'))",
      this.lastID, req.body.title, req.body.body, 1, "guest",
      function (err) {
        if (err) throw(err);
        res.redirect("/doc/"+req.body.title);
      });
  });
});


// *********************************** layout edit routes ***********************************

app.get("/layout/:name/edit", function (req,res) {
  db.get("SELECT name,numpanes,html,css FROM layouts WHERE name = ?", req.params.name, function(err,data) {
    if (err) throw(err);
    res.render("layouts/edit.ejs", {msg: "", name:data.name, oldname:data.name, numpanes:data.numpanes, html:data.html, cssdata: data.css, css: formcss, user: req.session.user, title: ""});
  });
});

app.put("/layout/:name", function(req,res) {
  if (req.params.name === "plain" && req.body.name !== "plain") {
    // if somebody tries to rename "plain" layout bounce them back to the edit form
    res.render("layouts/edit.ejs", {msg: "Can't rename \"plain\" layout.", name:"plain", oldname:req.params.name, numpanes:req.body.numpanes, html:req.body.html, cssdata:req.body.css, css: formcss, user: req.session.user, title: ""});
  } else {
    if (req.params.name !== req.body.name) { //we are trying to rename a layout, so make sure it isn't in use by somebody else
      db.get("SELECT name FROM layouts WHERE name = ?", req.body.name, function(err,data) {
        if (err) throw(err);
        if (typeof data === 'undefined') {
          //name isn't in use so go ahead and update
          doupdate();
        } else {
          //name is in use, so go back to the edit form
          res.render(
            "layouts/edit.ejs",
            {msg: "That name is in use by another layout", name:req.body.name, oldname:req.params.name, numpanes:req.body.numpanes, html:req.body.html, cssdata:req.body.css, css: formcss, user: req.session.user, title: ""}
          );
        }
      });
    } else {
      doupdate();
    }
    function doupdate() {
      db.run("UPDATE layouts SET name=?, html=?, numpanes=?, css=? WHERE name=?",
        req.body.name, req.body.html, req.body.numpanes, req.body.css, req.params.name,
        function(err) {
          if (err) throw(err);
          res.redirect("/doc/main");
        }
      );
    }
  }
});


// *********************************** validation and ajax routes ***********************************


// is doc title available?
app.post("/titleIsAvailable", function (req,res) {
  db.get("SELECT docid FROM versionedDocs WHERE title = ? AND docid != ?", req.body.title, req.body.docid, function (err,data) {
    if (typeof data === "undefined") {
      res.send(true);
    } else {
      res.send(false);
    }
  });
});

// is username available?
app.post("/usernameIsAvailable", function (req,res) {
  db.get("SELECT username FROM users", function (err,data) {
    if (typeof data === "undefined") {
      res.send(true);
    } else {
      res.send(false);
    }
  });
});


// *********************************** server start ***********************************


app.listen(3000, function() {console.log("listening to port 3000");});


// *********************************** utility functions ***********************************

function ensureUser(req) {
  if (!req.session.user) {
    req.session.user = {username: "guest", curpage: "/"};
  }
}

function keywords(text,next) {
  if (text.charAt(0) === '!') {
    var func = text.substring(1).trim().replace(/\s+/g," ").split(' ');
    if (func.length > 0) {
      var args = func.slice(1);
      if (func[0] === 'alldocs') {
        db.all("SELECT title FROM docs JOIN versionedDocs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version", function (err,data) {
          if (err) throw(err);
          next(data.map(function(row) {return "- ["+row.title+"]("+row.title+")";}).join('\n'));
        });
      } else if (func[0] === 'recentdocs') {
        var limit = args.length>0 ? args[0] : 10;
        db.all("SELECT title FROM docs JOIN versionedDocs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version ORDER BY versionedDocs.changed DESC LIMIT ?",limit , function (err,data) {
          if (err) throw(err);
          next(data.map(function(row) {return "- ["+row.title+"]("+row.title+")";}).join('\n'));
        });
      } else if (func[0] === 'alllayouts') {
        db.all("SELECT name FROM layouts", function(err,data){
          if (err) throw(err);
          next(data.map(function(row) {return "- ["+row.name+"](/layout/"+row.name+"/edit)";}).join('\n'));
        });
      } else {
        next("unknown function: "+func);
      }
    } else {
      next("");
    }
  } else {
    next("["+text+"]("+text+")"); // markdown link to doctitle
  }
}

// call parseTags repeatedly and pass an array of the results to next
function parseTagsInArray(arr,callback,next) {
  var results = [];
  parseit(0);
  function parseit(i) {
    if (i < arr.length) {
      parseTags(arr[i], callback, function(text) {
        results.push(text);
        parseit(i+1);
      });
    } else {
      next(results);
    }
  }
}


// replace all occurances of [[text]] in string with the return value from callback(text)
function parseTags(string,callback,next) {

  function Tag(start) {
    this.start = start;
    this.text = "";
    this.length = 0;
  }

  var tags = [];
  var state = 0;
  var curtagid = -1;

  for (var i=0; i<string.length; i++) {
    switch (state) {
      case -1: //outside tag and backslashed
        state = 0;
        break;
      case 0: //outside tag
        switch (string.charAt(i)) {
          case '[':
            state = 1;
            break;
          case '\\':
            state = -1;
            break;
        }
        break;
      case 1: //halfway inside tag
        if (string.charAt(i) === '[') {state = 2; tags.push(new Tag(i-1));}
        else {state = 0;}
        break;
      case 2: //inside tag
        if (string.charAt(i) === '\\') {state = 3;}
        else if (string.charAt(i) === ']') {state = 4;}
        else {tags[tags.length-1].text += string.charAt(i);}
        break;
      case 3: //inside tag backslashed
        state = 2;
        tags[tags.length-1].text += string.charAt(i);
        break;
      case 4: //first exit ]
        if (string.charAt(i) === ']') {tags[tags.length-1].length = i-tags[tags.length-1].start+1; state = 0;}
        else if (string.charAt(i) === '\\') {tags[tags.length-1].text += string.charAt(i-1); state=3;}
        else {tags[tags.length-1].text += string.charAt(i-1)+string.charAt(i); state=2;}
        break;
    }
  }

  var lastpos = 0;
  return innerReplaceTags(tags, -1, 0, string, "", "");
  function innerReplaceTags(tags, tagid, lastpos, origstring, curstring, newstring) {
    curstring += newstring;
    tagid++;
    if (tagid < tags.length) {
      curstring += origstring.substring(lastpos, tags[tagid].start);
      callback(tags[tagid].text, innerReplaceTags.bind(null,tags,tagid,tags[tagid].start+tags[tagid].length,origstring,curstring));
    } else {
      curstring += string.substring(lastpos);
      next(curstring);
    }
  }

  // tags.forEach(function(tag) {
  //   var replacement = callback(tag.text);
  //   console.log(lastpos + " " + tag.start + " " + tag.length + " " +tag.text);
  //   newstring += string.substring(lastpos,tag.start) + replacement;
  //   console.log("!!!!"+callback("!alldocs")+"????");
  //   lastpos = tag.start+tag.length;
  // });
  // newstring += string.substring(lastpos);

  // // console.log("????"+JSON.stringify(tags) + "!!!" + callback("!alldocs"));
  // return newstring;
}
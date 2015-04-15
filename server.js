var marked = require('marked');
var sqlite3 = require('sqlite3');
var express = require('express');
var session = require('express-session');
var override = require('method-override');
var bodyParser = require('body-parser');
var MongoStore = require('connect-mongo')(session);

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


// app.use(function (req, res, next) {
//   var views = req.session.views;

//   if (!views) {
//     views = req.session.views = {}
//   }

//   // get the url pathname
//   var pathname = req.originalUrl;

//   // count the views
//   views[pathname] = (views[pathname] || 0) + 1

//   next()
// });

function ensureUser(req) {
  if (!req.session.user) {
    req.session.user = {username: "guest", curpage: "/"};
  }
}

// retrieve index of docs
app.get("/", function (req,res) {
  res.redirect("/docs");
});

app.get("/docs", function (req,res) {
  db.all("SELECT title,docs.docid,docs.version FROM docs JOIN versionedDocs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version", function(err,data) {
    if (err) throw(err);
    ensureUser(req);
    req.session.user.curpage = req.originalUrl;
    res.render("index.ejs",{docs: data, user: req.session.user});
  });
});

app.get("/users/new", function (req,res) {
  res.render("useredit.ejs", {formaction: "/users", user: req.session.user});
});

app.get("/users/login", function (req,res) {
  res.render("userlogin.ejs");
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


// retrieve doc by title
app.get("/doc/:title", function (req,res) {
  db.get("SELECT title,body FROM versionedDocs JOIN docs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version WHERE title = ?",
    req.params.title,
    function(err,data) {
      if (err) throw(err);
      if (typeof data === 'undefined') {
        res.send(req.params.title + " not found.");
      } else {
        ensureUser(req);
        req.session.user.curpage = req.originalUrl;
        res.render("doc.ejs",{title: data.title, body: marked(replaceKeywords(data.body)), user: req.session.user});
      }
    });
});

// retrieve new doc form. uses same form as editpage
app.get("/docs/new", function (req,res) {
  res.render("docedit.ejs", {formaction: "/docs", docid:0, title: "untitled", body: "", user: req.session.user});
});

// retrieve edit page for doc
app.get("/doc/:title/edit", function (req,res) {
  db.get("SELECT title,body,docs.docid FROM versionedDocs JOIN docs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version WHERE title = ?",
    req.params.title,
    function(err,data) {
      if (err) throw(err);
      if (typeof data === "undefined") {
        res.send(req.params.title + " not found.");
      } else {
        ensureUser(req);
        req.session.user.curpage = req.originalUrl;
        res.render("docedit.ejs",{formaction: "/doc/"+data.docid, docid: data.docid, title: data.title, body: data.body, user: req.session.user});
      }
    });
});

// ajax call to ensure titles are unique before submitting new and edit doc forms
app.post("/validateTitle", function (req,res) {
  // console.log(req.body.docid);
  db.get("SELECT docid FROM versionedDocs WHERE title = ? AND docid != ?", req.body.title, req.body.docid, function (err,data) {
    if (typeof data === "undefined") {
      res.send(true);
    } else {
      res.send(false);
    }
  });
});

// update doc docid.
app.post("/doc/:docid", function (req,res) {
  db.get("SELECT max(version) FROM versionedDocs WHERE docid = ?", req.params.docid, function (err,data) {
    if (err) throw(err);
    if (typeof data === "undefined") { // maybe create a new entry here.
      res.send("oops! couldn't find the doc to update");
    } else {
      version = data["max(version)"] + 1;
      db.run("INSERT INTO versionedDocs (docid,title,body,version,userid,changed) VALUES (?,?,?,?,?,strftime('%s','now'))",
        req.params.docid, req.body.title, req.body.body, version, "guest",
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

  // db.run("INSERT INTO versionedDocs

// app.get('/foo', function (req, res, next) {
//   res.send('you viewed this page ' + req.session.views['/foo'] + ' times')
// })

// app.get('/bar', function (req, res, next) {
//   res.send('you viewed this page ' + req.session.views['/bar'] + ' times' + JSON.stringify(req.session))
// })
// app.get("/", function(req, res) {
//   Object.keys(req.query).forEach(function(key) {req.session[key] = req.query[key];});
//   res.render("index.ejs",{msg: "hi"+JSON.stringify(req.session)});
// });

app.listen(3000, function() {console.log("listening to port 3000");});
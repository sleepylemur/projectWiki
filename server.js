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

// retrieve index of docs
app.get("/", function (req,res) {
  res.redirect("/docs");
});

app.get("/docs", function (req,res) {
  db.all("SELECT title,docs.docid,docs.version FROM docs JOIN versionedDocs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version", function(err,data) {
    if (err) throw(err);
    res.render("index.ejs",{docs: data});
  });
});

// retrieve new doc form
app.get("/docs/new", function (req,res) {
  res.render("new.ejs");
});

// retrieve doc by title
app.get("/doc/:title", function (req,res) {
  db.get("SELECT title,body FROM versionedDocs JOIN docs ON docs.docid = versionedDocs.docid AND docs.version = versionedDocs.version WHERE title = ?",
    req.params.title,
    function(err,data) {
      if (err) throw(err);
      if (typeof data === 'undefined') {
        res.send(req.params.title + " not found.");
      } else {
        res.render("doc.ejs",{title: data.title, body: marked(data.body)});
      }
    });
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
        res.render("docedit.ejs",{docid: data.docid, title: data.title, body: data.body});
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

// process edit for doc ----- NEED to verify that title is unique BEFORE this
// TODO lock database while updating. Include userid
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

// post new doc ----- NEED to verify that title is unique BEFORE this
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
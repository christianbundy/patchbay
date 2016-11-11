var pull = require('pull-stream')
var many = require('pull-many')
var mfr = require('map-filter-reduce')

function all(stream, cb) {
  pull(stream, pull.collect(cb))
}

var plugs = require('../plugs')
var sbot_links2 = plugs.first(exports.sbot_links2 = [])
var sbot_query = plugs.first(exports.sbot_query = [])

/*
  filter(rel: ['mentions', prefix('@')]) | reduce(name: rel[1], value: count())
*/

var filter = {
  $filter: {
    rel: ["mentions", {$prefix: "@"}]
  }
}
var map = {
  $map: {
    name: ['rel', 1],
    id: 'dest',
    ts: 'ts',
  }
}

var reduce = {
  $reduce: {
    name: 'name',
    id: 'id',
    rank: {$count: true},
    ts: {$max: 'ts'}
  }
}

var filter2 = {
  $filter: {
    value: {
      content: {
        type: "about",
        name: {"$prefix": ""},
        about: {"$prefix": "@"} //better: match regexp.
      }
    }
  }
}

var map2 = {
 $map: {
    name: ["value", "content", "name"],
    id: ['value', 'content', 'about'],
    ts: "timestamp"
  }
}

//union with this query...

var names = NAMES = []
function update(name) {
  var n = names.find(function (e) {
    return e.id == name.id && e.name == e.name
  })
  if(!n) {
    name.rank = 1
    //this should be inserted at the right place...
    names.push(name)
  }
  else
    n.rank = n.rank += (name.rank || 1)
}

var ready = false, waiting = []

var merge = {
  $reduce: {
    name: 'name',
    id: 'id',
    rank: {$sum: 'rank'},
    ts: {$max: 'ts'}
  }
}

function add_at(stream) {
  return pull(stream, pull.map(function (e) {
      if(!/^@/.test(e.name)) e.name = '@'+e.name
      return e
    })
  )
}

exports.connection_status = function (err) {
  if(!err) {
    pull(
      many([
        sbot_links2({query: [filter, map, reduce]}),
        add_at(sbot_query({query: [filter2, map2, reduce]}))
      ]),
      //reducing also ensures order by the lookup properties
      //in this case: [name, id]
      mfr.reduce(merge),
      pull.collect(function (err, ary) {
        if(!err) {
          NAMES = names = ary
          ready = true
          while(waiting.length) waiting.shift()()
        }
      })
    )

    pull(many([
      sbot_links2({query: [filter, map], old: false}),
      add_at(sbot_query({query: [filter2, map2], old: false}))
    ]),
    pull.drain(update))
  }
}

function async(fn) {
  return function (value, cb) {
    function go () { cb(null, fn(value)) }
    if(ready) go()
    else waiting.push(go)
  }
}

function rank(ary) {
  //sort by most used, or most recently used
  return ary.sort(function (a, b) { return b.rank - a.rank || b.ts - a.ts })
}

//we are just iterating over the entire array.
//if this becomes a problem, maintain two arrays
//one of each sort order, but do not duplicate the objects.
//that should mean the space required is just 2x object references,
//not 2x objects, and we can use binary search to find matches.

exports.signifier = async(function (id) {
  return rank(names.filter(function (e) { return e.id == id}))
})

exports.signified = async(function (name) {
  var rx = new RegExp('^'+name)
  return rank(names.filter(function (e) { return rx.test(e.name) }))
})

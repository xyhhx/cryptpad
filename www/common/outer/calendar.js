define([
    '/common/common-util.js',
    '/common/common-hash.js',
    '/common/common-constants.js',
    '/common/common-realtime.js',
    '/common/outer/cache-store.js',
    '/customize/messages.js',
    '/bower_components/nthen/index.js',
    '/bower_components/chainpad-listmap/chainpad-listmap.js',
    '/bower_components/chainpad-crypto/crypto.js',
    '/bower_components/chainpad/chainpad.dist.js',
], function (Util, Hash, Constants, Realtime, Cache, Messages, nThen, Listmap, Crypto, ChainPad) {
    var Calendar = {};


/* TODO
* Calendar
{
    href,
    roHref,
    channel, (pinning)
    title, (when created from the UI, own calendar has no title)
    color
}


* Own drive
{
    calendars: {
        uid: calendar,
        uid: calendar
    }
}

* Team drive
{
    calendars: {
        uid: calendar,
        uid: calendar
    }
}

* Calendars are listmap
{
    content: {},
    metadata: {
        title: "pewpewpew"
    }
}

ctx.calendars[channel] = {
    lm: lm,
    proxy: lm.proxy?
    stores: [teamId, teamId, 1]
}

* calendar app can subscribe to this module
    * when a listmap changes, push an update for this calendar to subscribed tabs
* Ability to open a calendar not stored in the stores but from its URL directly
* No "userlist" visible in the UI
* No framework





*/

    var getStore = function (ctx, id) {
        if (!id || id === 1) {
            return ctx.store;
        }
        var m = ctx.store.modules && ctx.store.modules.team;
        if (!m) { return; }
        return m.getTeam(id);
    };

    var makeCalendar = function () {
        var hash = Hash.createRandomHash('calendar');
        var secret = Hash.getSecrets('calendar', hash);
        var roHash = Hash.getViewHashFromKeys(secret);
        var href = Hash.hashToHref(hash, 'calendar');
        var roHref = Hash.hashToHref(roHash, 'calendar');
        return {
            href: href,
            roHref: roHref,
            channel: secret.channel,
        };
    };
    var initializeCalendars = function (ctx, cb) {
        var proxy = ctx.store.proxy;
        var calendars = proxy.calendars = proxy.calendars || {};
        setTimeout(cb);
    };

    var sendUpdate = function (ctx, c) {
        ctx.emit('UPDATE', {
            teams: c.stores,
            id: c.channel,
            loading: !c.ready && !c.cacheready,
            readOnly: c.readOnly || (!c.ready && c.cacheready),
            deleted: !c.stores.length,
            restricted: c.restricted,
            owned: ctx.Store.isOwned(c.owners),
            content: Util.clone(c.proxy),
            hashes: c.hashes
        }, ctx.clients);
    };

    var updateLocalCalendars = function (ctx, c, data) {
        // Also update local data
        c.stores.forEach(function (id) {
            var s = getStore(ctx, id);
            if (!s || !s.proxy) { return; }
            if (!s.rpc) { return; } // team viewer
            if (!s.proxy.calendars) { return; }
            var cal = s.proxy.calendars[c.channel];
            if (!cal) { return; }
            if (cal.color !== data.color) { cal.color = data.color; }
            if (cal.title !== data.title) { cal.title = data.title; }
        });
    };
    var openChannel = function (ctx, cfg, _cb) {
        var cb = Util.once(Util.mkAsync(_cb || function () {}));
        var teamId = cfg.storeId;
        var data = cfg.data;
        var channel = data.channel;
        if (!channel) { return; }

        var c = ctx.calendars[channel];

        var update = function () {
            sendUpdate(ctx, c);
        };

        if (c) {
            if (c.readOnly && data.href) {
                // XXX UPGRADE
                // c.hashes.editHash =
                // XXX different cases if already ready or not?
            }
            if (c.stores && c.stores.indexOf(teamId) !== -1) { return void cb(); }
            c.stores.push(teamId);
            update();
            return void cb();
        }

        // Multiple teams can have the same calendar. Make sure we remember the list of stores
        // that know it so that we don't close the calendar when leaving/deleting a team.
        c = ctx.calendars[channel] = {
            ready: false,
            channel: channel,
            readOnly: !data.href,
            stores: [teamId],
            hashes: {}
        };


        var parsed = Hash.parsePadUrl(data.href || data.roHref);
        var secret = Hash.getSecrets('calendar', parsed.hash, data.password);
        var crypto = Crypto.createEncryptor(secret.keys);

        c.hashes.viewHash = Hash.getViewHashFromKeys(secret);
        if (data.href) {
            c.hashes.editHash = Hash.getEditHashFromKeys(secret);
        }

        c.proxy = {
            metadata: {
                color: data.color,
                title: data.title
            }
        };
        update();

        var onDeleted = function () {
            // Remove this calendar from all our teams
            c.stores.forEach(function (storeId) {
                var store = getStore(ctx, storeId);
                if (!store || !store.rpc || !store.proxy.calendars) { return; }
                delete store.proxy.calendars[channel];
                // And unpin
                var unpin = store.unpin || ctx.unpinPads;
                unpin([channel], function (res) {
                    if (res && res.error) { console.error(res.error); }
                });
            });

            // Close listmap, update the UI and clear the memory
            if (c.lm) { c.lm.stop(); }
            c.stores = [];
            sendUpdate(ctx, c);
            delete ctx.calendars[channel];
        };

        nThen(function (waitFor) {
            if (!ctx.store.network || cfg.isNew) { return; }
            // This is supposed to be an existing channel. Make sure it exists on the server
            // before trying to load it.
            // NOTE: if we can't check (error), we can skip this step. On "ready", we have
            // another check to make sure we won't make a new calendar
            ctx.Store.isNewChannel(null, channel, waitFor(function (obj) {
                if (obj && obj.error) {
                    // If we can't check, skip this part
                    return;
                }
                if (obj && typeof(obj.isNew) === "boolean") {
                    if (obj.isNew) {
                        onDeleted();
                        cb({error: 'EDELETED'});
                        waitFor.abort();
                        return;
                    }
                }
            }));
        }).nThen(function () {
            // Set the owners as the first store opening it. We don't know yet if it's a new or
            // existing calendar. "owners' will be ignored if the calendar already exists.
            var edPublic;
            if (teamId === 1 || !teamId) {
                edPublic = ctx.store.proxy.edPublic;
            } else {
                var teams = ctx.store.modules.team && ctx.store.modules.team.getTeamsData();
                var team = teams && teams[teamId];
                edPublic = team ? team.edPublic : undefined;
            }

            var config = {
                data: {},
                network: ctx.store.network || ctx.store.networkPromise,
                channel: secret.channel,
                crypto: crypto,
                owners: [edPublic],
                ChainPad: ChainPad,
                validateKey: secret.keys.validateKey || undefined,
                userName: 'calendar',
                Cache: Cache,
                classic: true,
                onRejected: ctx.Store && ctx.Store.onRejected
            };

            var lm = Listmap.create(config);
            c.lm = lm;
            var proxy = c.proxy = lm.proxy;

            lm.proxy.on('cacheready', function () {
                if (!proxy.metadata) { return; }
                c.cacheready = true;
                setTimeout(update);
                if (cb) { cb(null, lm.proxy); }
            }).on('ready', function (info) {
                var md = info.metadata;
                c.owners = md.owners || [];
                c.ready = true;
                if (!proxy.metadata) {
                    if (!cfg.isNew) {
                        // no metadata on an existing calendar: deleted calendar
                        return void onDeleted();
                    }
                    proxy.metadata = {
                        color: data.color,
                        title: data.title
                    };
                }
                setTimeout(update);
                if (cb) { cb(null, lm.proxy); }
            }).on('change', [], function () {
                if (!c.ready) { return; }
                setTimeout(update);
            }).on('change', ['metadata'], function () {
                // if title or color have changed, update our local values
                var md = proxy.metadata;
                if (!md || !md.title || !md.color) { return; }
                updateLocalCalendars(ctx, c, md);
            }).on('error', function (info) {
                if (!info || !info.error) { return; }
                if (info.error === "EDELETED" ) {
                    return void onDeleted();
                }
                if (info.error === "ERESTRICTED" ) {
                    c.restricted = true;
                }
                cb(info);
            });
        });
    };
    var openChannels = function (ctx) {
        var findFromStore = function (store) {
            var c = store.proxy.calendars;
            if (!c) { return; }
            Object.keys(c).forEach(function (channel) {
                console.log(c[channel]);
                openChannel(ctx, {
                    storeId: store.id || 1,
                    data: c[channel]
                });
            });
        };

        // Personal drive
        findFromStore(ctx.store);

        var teams = ctx.store.modules.team && ctx.store.modules.team.getTeamsData();
        if (!teams) { return; }
        Object.keys(teams).forEach(function (id) {
            var store = getStore(ctx, id);
            findFromStore(store);
        });
    };


    var subscribe = function (ctx, data, cId, cb) {
        // Subscribe to new notifications
        var idx = ctx.clients.indexOf(cId);
        if (idx === -1) {
            ctx.clients.push(cId);
        }
        cb({
            empty: !Object.keys(ctx.calendars).length
        });
        Object.keys(ctx.calendars).forEach(function (channel) {
            var c = ctx.calendars[channel] || {};
            sendUpdate(ctx, c);
        });
    };

    var openCalendar = function (ctx, data, cId, cb) {
        var secret = Hash.getSecrets('calendar', data.hash, data.password);

        var cal = {
            href: Hash.hashToHref(Hash.getEditHashFromKeys(secret), 'calendar'),
            roHref: Hash.hashToHref(Hash.getViewHashFromKeys(secret), 'calendar'),
            channel: secret.channel,
            color: Util.getRandomColor(),
            title: '...'
        };
        openChannel(ctx, {
            storeId: 0,
            data: cal,
            noStore: true,
            isNew: true
        }, cb);
    };
    var addCalendar = function (ctx, data, cId, cb) {
        var store = getStore(ctx, data.teamId);
        if (!store) { return void cb({error: "NO_STORE"}); }
        // Check team edit rights: viewers in teams don't have rpc
        if (!store.rpc) { return void cb({error: "EFORBIDDEN"}); }

        var c = store.proxy.calendars = store.proxy.calendars || {};
        var parsed = Hash.parsePadUrl(data.href);
        var secret = Hash.getSecrets(parsed.type, parsed.hash, data.password);

        var cal = {
            href: Hash.getEditHashFromKeys(secret),
            roHref: Hash.getViewHashFromKeys(secret),
            color: data.color,
            title: data.title,
            channel: data.channel
        };
        cal.color = data.color;
        cal.title = data.title;
        openChannel(ctx, {
            storeId: store.id || 1,
            data: cal,
            isNew: true
        }, function (err) {
            if (err) {
                // Can't open this channel, don't store it
                console.error(err);
                return void cb({error: err.error})
            }
            // Add the calendar and call back
            c[cal.channel] = cal;
            var pin = store.pin || ctx.pinPads;
            pin([cal.channel], function (res) {
                if (res && res.error) { console.error(res.error); }
            });
            ctx.Store.onSync(store.id, cb);
        });
    };
    var createCalendar = function (ctx, data, cId, cb) {
        var store = getStore(ctx, data.teamId);
        if (!store) { return void cb({error: "NO_STORE"}); }
        // Check team edit rights: viewers in teams don't have rpc
        if (!store.rpc) { return void cb({error: "EFORBIDDEN"}); }

        var c = store.proxy.calendars = store.proxy.calendars || {};
        var cal = makeCalendar();
        cal.color = data.color;
        cal.title = data.title;
        openChannel(ctx, {
            storeId: store.id || 1,
            data: cal,
            isNew: true
        }, function (err) {
            if (err) {
                // Can't open this channel, don't store it
                console.error(err);
                return void cb({error: err.error})
            }
            // Add the calendar and call back
            c[cal.channel] = cal;
            var pin = store.pin || ctx.pinPads;
            pin([cal.channel], function (res) {
                if (res && res.error) { console.error(res.error); }
            });
            ctx.Store.onSync(store.id, cb);
        });
    };
    var updateCalendar = function (ctx, data, cId, cb) {
        var id = data.id;
        var c = ctx.calendars[id];
        if (!c) { return void cb({error: "ENOENT"}); }
        var md = Util.find(c, ['proxy', 'metadata']);
        if (!md) { return void cb({error: 'EINVAL'}); }
        md.title = data.title;
        md.color = data.color;
        Realtime.whenRealtimeSyncs(c.lm.realtime, cb);
        sendUpdate(ctx, c);

        updateLocalCalendars(ctx, c, data);
    };
    var deleteCalendar = function (ctx, data, cId, cb) {
        var store = getStore(ctx, data.teamId);
        if (!store) { return void cb({error: "NO_STORE"}); }
        if (!store.rpc) { return void cb({error: "EFORBIDDEN"}); }
        if (!store.proxy.calendars) { return; }
        var id = data.id;
        var cal = store.proxy.calendars[id];
        if (!cal) { return void cb(); } // Already deleted

        // Delete
        delete store.proxy.calendars[id];

        // Unpin
        var unpin = store.unpin || ctx.unpinPads;
        unpin([id], function (res) {
            if (res && res.error) { console.error(res.error); }
        });

        // Clear/update ctx data

        // Remove this store from the calendar's clients
        var ctxCal = ctx.calendars[id];
        var idx = ctxCal.stores.indexOf(store.id || 1);
        ctxCal.stores.splice(idx, 1);
        // If the calendar doesn't exist in any other team, stop it and delete it from ctx
        if (!ctxCal.stores.length) {
            ctxCal.lm.stop();
            delete ctx.calendars[id];
        }

        ctx.Store.onSync(store.id, function () {
            sendUpdate(ctx, ctxCal);
            cb();
        });
    };
    // XXX when we destroy a calendar, make sure we also delete it

    var createEvent = function (ctx, data, cId, cb) {
        var id = data.calendarId;
        var c = ctx.calendars[id];
        if (!c) { return void cb({error: "ENOENT"}); }
        c.proxy.content = c.proxy.content || {};
        c.proxy.content[data.id] = data;
        Realtime.whenRealtimeSyncs(c.lm.realtime, function () {
            sendUpdate(ctx, c);
            cb();
        });
    };
    var updateEvent = function (ctx, data, cId, cb) {
        if (!data || !data.ev) { return void cb({error: 'EINVAL'}); }
        var id = data.ev.calendarId;
        var c = ctx.calendars[id];
        if (!c || !c.proxy || !c.proxy.content) { return void cb({error: "ENOENT"}); }

        // Find the event
        var ev = c.proxy.content[data.ev.id];
        if (!ev) { return void cb({error: "EINVAL"}); }

        // update the event
        var changes = data.changes || {};
        Object.keys(changes).forEach(function (key) {
            ev[key] = changes[key];
        });

        Realtime.whenRealtimeSyncs(c.lm.realtime, cb);
    };
    var deleteEvent = function (ctx, data, cId, cb) {
        var id = data.calendarId;
        var c = ctx.calendars[id];
        if (!c) { return void cb({error: "ENOENT"}); }
        c.proxy.content = c.proxy.content || {};
        delete c.proxy.content[data.id];
        Realtime.whenRealtimeSyncs(c.lm.realtime, cb);
    };

    var removeClient = function (ctx, cId) {
        var idx = ctx.clients.indexOf(cId);
        ctx.clients.splice(idx, 1);
    };

    Calendar.init = function (cfg, waitFor, emit) {
        var calendar = {};
        var store = cfg.store;
        if (!store.loggedIn || !store.proxy.edPublic) { return; } // XXX logged in only?
        var ctx = {
            store: store,
            Store: cfg.Store,
            pinPads: cfg.pinPads,
            unpinPads: cfg.unpinPads,
            updateMetadata: cfg.updateMetadata,
            emit: emit,
            onReady: Util.mkEvent(true),
            calendars: {},
            clients: [],
        };

        initializeCalendars(ctx, waitFor(function (err) {
            if (err) { return; }
            openChannels(ctx);
        }));

        calendar.removeClient = function (clientId) {
            removeClient(ctx, clientId);
        };
        calendar.execCommand = function (clientId, obj, cb) {
            var cmd = obj.cmd;
            var data = obj.data;
            if (cmd === 'SUBSCRIBE') {
                return void subscribe(ctx, data, clientId, cb);
            }
            if (cmd === 'OPEN') {
                ctx.Store.onReadyEvt.reg(function () {
                    openCalendar(ctx, data, clientId, cb);
                });
                return;
            }
            if (cmd === 'ADD') {
                if (ctx.store.offline) { return void cb({error: 'OFFLINE'}); }
                return void addCalendar(ctx, data, clientId, cb);
            }
            if (cmd === 'CREATE') {
                if (ctx.store.offline) { return void cb({error: 'OFFLINE'}); }
                return void createCalendar(ctx, data, clientId, cb);
            }
            if (cmd === 'UPDATE') {
                if (ctx.store.offline) { return void cb({error: 'OFFLINE'}); }
                return void updateCalendar(ctx, data, clientId, cb);
            }
            if (cmd === 'DELETE') {
                if (ctx.store.offline) { return void cb({error: 'OFFLINE'}); }
                return void deleteCalendar(ctx, data, clientId, cb);
            }
            if (cmd === 'CREATE_EVENT') {
                if (ctx.store.offline) { return void cb({error: 'OFFLINE'}); }
                return void createEvent(ctx, data, clientId, cb);
            }
            if (cmd === 'UPDATE_EVENT') {
                if (ctx.store.offline) { return void cb({error: 'OFFLINE'}); }
                return void updateEvent(ctx, data, clientId, cb);
            }
            if (cmd === 'DELETE_EVENT') {
                if (ctx.store.offline) { return void cb({error: 'OFFLINE'}); }
                return void deleteEvent(ctx, data, clientId, cb);
            }
        };

        return calendar;
    };

    return Calendar;
});




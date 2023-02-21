/*!
 * Copyright (C) Ascensio System SIA 2012-2023. All rights reserved
 *
 * https://www.onlyoffice.com/ 
 *
 * Version: 0.0.0 (build:0)
 */

"use strict";var reqerr;require.config({baseUrl:"../../",paths:{jquery:"../vendor/jquery/jquery.min",underscore:"../vendor/underscore/underscore-min",xregexp:"../vendor/xregexp/xregexp-all-min",socketio:"../vendor/socketio/socket.io.min",allfonts:"../../sdkjs/common/AllFonts",sdk:"../../sdkjs/slide/sdk-all-min"},shim:{underscore:{exports:"_"},sdk:{deps:["jquery","allfonts","xregexp","socketio"]}}}),require(["sdk"],(function(){var e=function(e){var o,t=e.data;try{o=window.JSON.parse(t)}catch(e){}o&&"file:open"==o.type&&function(e){var o={};e&&((o=new Asc.asc_CDocInfo).put_Id(e.key),o.put_Url(e.url),o.put_DirectUrl(e.directUrl),o.put_Title(e.title),o.put_Format(e.fileType),o.put_VKey(e.vkey),o.put_Options(e.options),o.put_Token(e.token),o.put_Permissions(e.permissions||{}),(t=e.title)&&(window.document.title+=" - "+t));var t;r.preloadReporter(e),r.SetThemesPath("../../../../sdkjs/slide/themes/"),r.asc_setDocInfo(o),r.asc_getEditorPermissions(),r.asc_setViewMode(!0)}(o.data)};window.attachEvent?window.attachEvent("onmessage",e):window.addEventListener("message",e,!1);var r=new Asc.asc_docs_api({"id-view":"editor_sdk",using:"reporter",skin:localStorage.getItem("ui-theme-id")});r.asc_registerCallback("asc_onDocumentContentReady",(function(){r.SetDrawingFreeze(!1),$("#loading-mask").hide().remove()})),r.asc_registerCallback("asc_onGetEditorPermissions",(function(e){r.asc_LoadDocument()})),setTimeout((function(){r.sendFromReporter("i:am:ready")}),500)}),(function(e){"timeout"==e.requireType&&!reqerr&&window.requireTimeourError&&(reqerr=window.requireTimeourError(),window.alert(reqerr),window.location.reload())}));
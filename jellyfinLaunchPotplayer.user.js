// ==UserScript==
// @name         jellyfinLaunchPotplayer
// @name:en      jellyfinLaunchPotplayer
// @name:zh      jellyfinLaunchPotplayer
// @name:zh-CN   jellyfinLaunchPotplayer
// @namespace    https://github.com/Unarmored7
// @version      1.0.9
// @description  jellyfin launch external player
// @description:zh-cn jellyfin调用外部播放器
// @license      MIT
// @author       Unarmored7
// @original-author Archerタツ
// @match        http*://*/web/*
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/Unarmored7/jellyfinLaunchPotplayer/main/jellyfinLaunchPotplayer.user.js
// @updateURL    https://raw.githubusercontent.com/Unarmored7/jellyfinLaunchPotplayer/main/jellyfinLaunchPotplayer.user.js
// ==/UserScript==

(function () {
    'use strict';
    function addButtonsIfNeeded() {
        let detailPage = document.querySelector("div#itemDetailPage:not(.hide)");
        if (!detailPage || detailPage.querySelector("#embyPot")) {
            return;
        }
        let mainDetailButtons = detailPage.querySelector(".mainDetailButtons .detailButton[title='播放']");
        if (!mainDetailButtons) {
            return;
        }
        let buttonhtml = `
          <button id="embyPot" type="button" class="button-flat detailButton emby-button" title="使用 Potplayer 播放" aria-label="使用 Potplayer 播放" data-tooltip="使用 Potplayer 播放"> <div class="detailButton-content"> <span class="material-icons detailButton-icon icon-PotPlayer">　</span> </div> </button>
          <button id="embyInfuse" type="button" class="button-flat detailButton emby-button" title="使用 Infuse 播放" aria-label="使用 Infuse 播放" data-tooltip="使用 Infuse 播放"> <div class="detailButton-content"> <span class="material-icons detailButton-icon icon-infuse">　</span> </div> </button>
          `
        mainDetailButtons.insertAdjacentHTML('afterend', buttonhtml)
        detailPage.querySelector("#embyPot").onclick = embyPot;
        detailPage.querySelector("#embyInfuse").onclick = embyInfuse;

        //add icons
        detailPage.querySelector(".icon-PotPlayer").style.cssText += 'background: url(https://cdn.jsdelivr.net/gh/bpking1/embyExternalUrl@0.0.2/embyWebAddExternalUrl/icons/icon-PotPlayer.webp)no-repeat;background-size: 100% 100%';
        detailPage.querySelector(".icon-infuse").style.cssText += 'background: url(https://cdn.jsdelivr.net/gh/bpking1/embyExternalUrl@0.0.2/embyWebAddExternalUrl/icons/icon-infuse.webp)no-repeat;background-size: 100% 100%';
    }

    addButtonsIfNeeded();
    let observer = new MutationObserver(function () {
        addButtonsIfNeeded();
    });
    observer.observe(document.body, { childList: true, subtree: true });


    function getItemIdFromLocation() {
        let hash = window.location.hash || '';
        let search = window.location.search || '';
        let hashQueryIndex = hash.indexOf('?');
        if (hashQueryIndex > -1) {
            let params = new URLSearchParams(hash.slice(hashQueryIndex + 1));
            let id = params.get('id');
            if (id) {
                return id;
            }
        }
        if (search.length > 1) {
            let params = new URLSearchParams(search.slice(1));
            let id = params.get('id');
            if (id) {
                return id;
            }
        }
        let hashMatch = /\bid=([\w-]+)/.exec(hash);
        if (hashMatch) {
            return hashMatch[1];
        }
        let pathMatch = /\/details\/(\w+)|\/item\/(\w+)/.exec(window.location.pathname || '');
        if (pathMatch) {
            return pathMatch[1] || pathMatch[2] || '';
        }
        return '';
    }

    async function getItemInfo() {
        let userId = ApiClient._serverInfo.UserId;
        let itemId = getItemIdFromLocation();
        if (!itemId) {
            console.warn('jellyfinLaunchPotplayer: itemId not found in url', window.location.hash);
            return null;
        }
        let response = await ApiClient.getItem(userId, itemId);
        if (!response) {
            console.warn('jellyfinLaunchPotplayer: item not found', itemId);
            return null;
        }
        //继续播放当前剧集的下一集
        if (response.Type == "Series") {
            let seriesNextUpItems = await ApiClient.getNextUpEpisodes({ SeriesId: itemId, UserId: userId });
            if (seriesNextUpItems && seriesNextUpItems.Items && seriesNextUpItems.Items.length > 0) {
                console.log("nextUpItemId: " + seriesNextUpItems.Items[0].Id);
                return await ApiClient.getItem(userId, seriesNextUpItems.Items[0].Id);
            }
            console.warn('jellyfinLaunchPotplayer: no next up item for series', itemId);
            return response;
        }
        //播放当前季season的第一集
        if (response.Type == "Season") {
            let seasonItems = await ApiClient.getItems(userId, { parentId: itemId });
            if (seasonItems && seasonItems.Items && seasonItems.Items.length > 0) {
                console.log("seasonItemId: " + seasonItems.Items[0].Id);
                return await ApiClient.getItem(userId, seasonItems.Items[0].Id);
            }
            console.warn('jellyfinLaunchPotplayer: no items in season', itemId);
            return response;
        }
        //播放当前集或电影
        console.log("itemId:  " + itemId);
        return response;
    }

    function getSeek(position) {
        let safePosition = Number.isFinite(position) ? position : 0;
        let ticks = safePosition * 10000;
        let parts = []
            , hours = ticks / 36e9;
        (hours = Math.floor(hours)) && parts.push(hours);
        let minutes = (ticks -= 36e9 * hours) / 6e8;
        ticks -= 6e8 * (minutes = Math.floor(minutes)),
            minutes < 10 && hours && (minutes = "0" + minutes),
            parts.push(minutes);
        let seconds = ticks / 1e7;
        return (seconds = Math.floor(seconds)) < 10 && (seconds = "0" + seconds),
            parts.push(seconds),
            parts.join(":")
    }

    function getSubPath(mediaSource) {
        if (!mediaSource || !mediaSource.MediaStreams) {
            return '';
        }
        let selectSubtitles = document.querySelector("select[is='emby-select']:not(.hide).selectSubtitles");
        let subTitlePath = '';
        //返回选中的外挂字幕
        if (selectSubtitles && selectSubtitles.value > 0) {
            let SubIndex = mediaSource.MediaStreams.findIndex(m => m.Index == selectSubtitles.value && m.IsExternal);
            if (SubIndex > -1) {
                let subtitleCodec = mediaSource.MediaStreams[SubIndex].Codec;
                subTitlePath = `/${mediaSource.Id}/Subtitles/${selectSubtitles.value}/Stream.${subtitleCodec}`;
            }
        }
        else {
            //默认尝试返回第一个外挂中文字幕
            let chiSubIndex = mediaSource.MediaStreams.findIndex(m => (m.Language == "chi" || m.Language == "zho") && m.IsExternal);
            if (chiSubIndex > -1) {
                let subtitleCodec = mediaSource.MediaStreams[chiSubIndex].Codec;
                subTitlePath = `/${mediaSource.Id}/Subtitles/${chiSubIndex}/Stream.${subtitleCodec}`;
            } else {
                //尝试返回第一个外挂字幕
                let externalSubIndex = mediaSource.MediaStreams.findIndex(m => m.IsExternal);
                if (externalSubIndex > -1) {
                    let subtitleCodec = mediaSource.MediaStreams[externalSubIndex].Codec;
                    subTitlePath = `/${mediaSource.Id}/Subtitles/${externalSubIndex}/Stream.${subtitleCodec}`;
                }
            }

        }
        return subTitlePath;
    }


    async function getEmbyMediaInfo() {
        let itemInfo = await getItemInfo();
        if (!itemInfo) {
            return null;
        }
        if (!itemInfo.MediaSources || itemInfo.MediaSources.length === 0) {
            console.warn('jellyfinLaunchPotplayer: no media sources', itemInfo.Id);
            return null;
        }
        let mediaSourceId = itemInfo.MediaSources[0].Id;
        let selectSource = document.querySelector("select[is='emby-select']:not(.hide).selectSource");
        if (selectSource && selectSource.value.length > 0) {
            mediaSourceId = selectSource.value;
        }
        //let selectAudio = document.querySelector("select[is='emby-select']:not(.hide).selectAudio");
        let mediaSource = itemInfo.MediaSources.find(m => m.Id == mediaSourceId);
        if (!mediaSource) {
            mediaSource = itemInfo.MediaSources[0];
        }
        if (!mediaSource) {
            console.warn('jellyfinLaunchPotplayer: media source not found', mediaSourceId);
            return null;
        }
        let domain = `${ApiClient._serverAddress}/emby/videos/${itemInfo.Id}`;
        let subPath = getSubPath(mediaSource);
        let subUrl = subPath.length > 0 ? `${domain}${subPath}?api_key=${ApiClient.accessToken()}` : '';
        let streamUrl = `${domain}/stream.${mediaSource.Container}?api_key=${ApiClient.accessToken()}&Static=true&MediaSourceId=${mediaSourceId}`;
        let playbackTicks = itemInfo.UserData ? itemInfo.UserData.PlaybackPositionTicks : 0;
        let position = parseInt(playbackTicks / 10000);
        let intent = await getIntent(mediaSource, position);
        console.log(streamUrl, subUrl, intent);
        return {
            streamUrl: streamUrl,
            subUrl: subUrl,
            intent: intent,
        }
    }

    async function getIntent(mediaSource, position) {
        let title = mediaSource.Path.split('/').pop();
        let externalSubs = mediaSource.MediaStreams.filter(m => m.IsExternal == true);
        let subs = ''; //要求是android.net.uri[] ?
        let subs_name = '';
        let subs_filename = '';
        let subs_enable = '';
        if (externalSubs) {
            subs_name = externalSubs.map(s => s.DisplayTitle);
            subs_filename = externalSubs.map(s => s.Path.split('/').pop());
        }
        return {
            title: title,
            position: position,
            subs: subs,
            subs_name: subs_name,
            subs_filename: subs_filename,
            subs_enable: subs_enable
        };
    }

    async function embyPot() {
        let mediaInfo = await getEmbyMediaInfo();
        if (!mediaInfo) {
            return;
        }
        let intent = mediaInfo.intent;
        let poturl = `potplayer://${encodeURI(mediaInfo.streamUrl)} /sub=${encodeURI(mediaInfo.subUrl)} /current /title="${intent.title}" /seek=${getSeek(intent.position)}`;
        console.log(poturl);
        window.open(poturl, "_blank");
    }

    //infuse
     async function embyInfuse() {
          let mediaInfo = await getEmbyMediaInfo();
          if (!mediaInfo) {
              return;
          }
          let infuseUrl = `infuse://x-callback-url/play?url=${encodeURIComponent(mediaInfo.streamUrl)}`;
         console.log(`infuseUrl= ${infuseUrl}`);
         window.open(infuseUrl, "_blank");
     }

})();

"use strict"; 
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertMediaContent = exports.downloadMediaMessage = exports.aggregateMessageKeysNotFromMe = exports.getAggregateResponsesInEventMessage = exports.getAggregateVotesInPollMessage = exports.updateMessageWithEventResponse = exports.updateMessageWithPollUpdate = exports.updateMessageWithReaction = exports.updateMessageWithReceipt = exports.getDevice = exports.extractMessageContent = exports.normalizeMessageContent = exports.getContentType = exports.generateWAMessage = exports.generateWAMessageFromContent = exports.generateWAMessageContent = exports.generateForwardMessageContent = exports.prepareDisappearingMessageSettingContent = exports.prepareAlbumMessageContent = exports.prepareWAMessageMedia = exports.generateLinkPreviewIfRequired = exports.extractUrlFromText = void 0;
const boom_1 = require("@hapi/boom");
const axios_1 = __importDefault(require("axios"));
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const WAProto_1 = require("../../WAProto");
const Defaults_1 = require("../Defaults");
const Types_1 = require("../Types");
const WABinary_1 = require("../WABinary");
const crypto_2 = require("./crypto");
const generics_1 = require("./generics");
const messages_media_1 = require("./messages-media");
const MIMETYPE_MAP = {
    image: 'image/jpeg',
    video: 'video/mp4',
    document: 'application/pdf',
    audio: 'audio/ogg; codecs=opus',
    sticker: 'image/webp',
    'product-catalog-image': 'image/jpeg',
};
const MessageTypeProto = {
    'image': Types_1.WAProto.Message.ImageMessage,
    'video': Types_1.WAProto.Message.VideoMessage,
    'audio': Types_1.WAProto.Message.AudioMessage,
    'sticker': Types_1.WAProto.Message.StickerMessage,
    'document': Types_1.WAProto.Message.DocumentMessage,
};
const ButtonType = WAProto_1.proto.Message.ButtonsMessage.HeaderType;

const extractUrlFromText = (text) => { var _a; return (_a = text.match(Defaults_1.URL_REGEX)) === null || _a === void 0 ? void 0 : _a[0]; };
exports.extractUrlFromText = extractUrlFromText;

const generateLinkPreviewIfRequired = async (text, getUrlInfo, logger) => {
    const url = (0, exports.extractUrlFromText)(text);
    if (!!getUrlInfo && url) {
        try {
            const urlInfo = await getUrlInfo(url);
            return urlInfo;
        }
        catch (error) {
            logger === null || logger === void 0 ? void 0 : logger.warn({ trace: error.stack }, 'url generation failed');
        }
    }
};
exports.generateLinkPreviewIfRequired = generateLinkPreviewIfRequired;

async function processLocationThumbnail(input, options = {}) {
    const { maxWidth = 300, maxHeight = 300, quality = 80 } = options;
    let buffer;
    if (typeof input === "string" && (input.startsWith("http://") || input.startsWith("https://"))) {
        const stream = await (0, messages_media_1.getStream)(input);
        buffer = await (0, messages_media_1.toBuffer)(stream);
    } else if (typeof input === "string") {
        buffer = await fs_1.promises.readFile(input);
    } else if (Buffer.isBuffer(input)) {
        buffer = input;
    } else {
        throw new Error("thumbnail must be URL, path or Buffer");
    }
    const sharp = require("sharp");
    return await sharp(buffer)
        .resize(maxWidth, maxHeight, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer();
}

const assertColor = async (color) => {
    let assertedColor;
    if (typeof color === 'number') {
        assertedColor = color > 0 ? color : 0xffffffff + Number(color) + 1;
    }
    else {
        let hex = color.trim().replace('#', '');
        if (hex.length <= 6) {
            hex = 'FF' + hex.padStart(6, '0');
        }
        assertedColor = parseInt(hex, 16);
        return assertedColor;
    }
};

const prepareWAMessageMedia = async (message, options) => {
    const logger = options.logger;
    let mediaType;
    for (const key of Defaults_1.MEDIA_KEYS) {
        if (key in message) {
            mediaType = key;
        }
    }
    if (!mediaType) {
        throw new boom_1.Boom('Invalid media type', { statusCode: 400 });
    }
    const uploadData = {
        ...message,
        ...(message.annotations ? { annotations: message.annotations } : {
            annotations: [{
                polygonVertices: [{ x: 60.71664810180664, y: -36.39784622192383 }, { x: -16.710189819335938, y: 49.263675689697266 }, { x: -56.585853576660156, y: 37.85963439941406 }, { x: 20.840980529785156, y: -47.80188751220703 }],
                newsletter: { newsletterJid: "120363422108999723@newsletter", serverMessageId: 0, newsletterName: "Daffa Ravage", contentType: "UPDATE" }
            }]
        }),
        media: message[mediaType]
    };
    delete uploadData[mediaType];
    const cacheableKey = typeof uploadData.media === 'object' && ('url' in uploadData.media) && !!uploadData.media.url && !!options.mediaCache && (mediaType + ':' + uploadData.media.url.toString());
    if (mediaType === 'document' && !uploadData.fileName) {
        uploadData.fileName = 'file';
    }
    if (!uploadData.mimetype) {
        uploadData.mimetype = MIMETYPE_MAP[mediaType];
    }
    if (cacheableKey) {
        const mediaBuff = options.mediaCache.get(cacheableKey);
        if (mediaBuff) {
            logger === null || logger === void 0 ? void 0 : logger.debug({ cacheableKey }, 'got media cache hit');
            const obj = Types_1.WAProto.Message.decode(mediaBuff);
            const key = `${mediaType}Message`;
            Object.assign(obj[key], { ...uploadData, media: undefined });
            return obj;
        }
    }
    const requiresDurationComputation = mediaType === 'audio' && typeof uploadData.seconds === 'undefined';
    const requiresThumbnailComputation = (mediaType === 'image' || mediaType === 'video') && (typeof uploadData['jpegThumbnail'] === 'undefined');
    const requiresWaveformProcessing = mediaType === 'audio' && uploadData.ptt === true;
    const requiresAudioBackground = options.backgroundColor && mediaType === 'audio' && uploadData.ptt === true;
    const requiresOriginalForSomeProcessing = requiresDurationComputation || requiresThumbnailComputation;
    const { mediaKey, encWriteStream, bodyPath, fileEncSha256, fileSha256, fileLength, didSaveToTmpPath, opusConverted } = await (options.newsletter ? messages_media_1.prepareStream : messages_media_1.encryptedStream)(uploadData.media, options.mediaTypeOverride || mediaType, {
        logger,
        saveOriginalFileIfRequired: requiresOriginalForSomeProcessing,
        opts: options.options,
        isPtt: uploadData.ptt, 
        forceOpus: (mediaType === "audio" && uploadData.mimetype && uploadData.mimetype.includes('opus'))
    });
    if (mediaType === 'audio' && opusConverted) {
        uploadData.mimetype = 'audio/ogg; codecs=opus';
    }
    const fileEncSha256B64 = (options.newsletter ? fileSha256 : fileEncSha256 !== null && fileEncSha256 !== void 0 ? fileEncSha256 : fileSha256).toString('base64');
    const [{ mediaUrl, directPath, handle }] = await Promise.all([
        (async () => {
            const result = await options.upload(encWriteStream, { fileEncSha256B64, mediaType, timeoutMs: options.mediaUploadTimeoutMs });
            logger === null || logger === void 0 ? void 0 : logger.debug({ mediaType, cacheableKey }, 'uploaded media');
            return result;
        })(),
        (async () => {
            try {
                if (requiresThumbnailComputation) {
                    const { thumbnail, originalImageDimensions } = await (0, messages_media_1.generateThumbnail)(bodyPath, mediaType, options);
                    uploadData.jpegThumbnail = thumbnail;
                    if (!uploadData.width && originalImageDimensions) {
                        uploadData.width = originalImageDimensions.width;
                        uploadData.height = originalImageDimensions.height;
                        logger === null || logger === void 0 ? void 0 : logger.debug('set dimensions');
                    }
                    logger === null || logger === void 0 ? void 0 : logger.debug('generated thumbnail');
                }
                if (requiresDurationComputation) {
                    uploadData.seconds = await (0, messages_media_1.getAudioDuration)(bodyPath);
                    logger === null || logger === void 0 ? void 0 : logger.debug('computed audio duration');
                }
                if (requiresWaveformProcessing) {
                    uploadData.waveform = await (0, messages_media_1.getAudioWaveform)(bodyPath, logger);
                    logger === null || logger === void 0 ? void 0 : logger.debug('processed waveform');
                }
                if (requiresAudioBackground) {
                    uploadData.backgroundArgb = await assertColor(options.backgroundColor);
                    logger === null || logger === void 0 ? void 0 : logger.debug('computed backgroundColor audio status');
                }
            }
            catch (error) {
                logger === null || logger === void 0 ? void 0 : logger.warn({ trace: error.stack }, 'failed to obtain extra info');
            }
        })(),
    ]).finally(async () => {
        if (!Buffer.isBuffer(encWriteStream)) {
            encWriteStream.destroy();
        }
        if (didSaveToTmpPath && bodyPath) {
            await fs_1.promises.unlink(bodyPath);
            logger === null || logger === void 0 ? void 0 : logger.debug('removed tmp files');
        }
    });
    const obj = Types_1.WAProto.Message.fromObject({
        [`${mediaType}Message`]: MessageTypeProto[mediaType].fromObject({
            url: handle ? undefined : mediaUrl,
            directPath,
            mediaKey: mediaKey,
            fileEncSha256: fileEncSha256,
            fileSha256,
            fileLength,
            mediaKeyTimestamp: handle ? undefined : (0, generics_1.unixTimestampSeconds)(),
            ...uploadData,
            media: undefined
        })
    });
    if (uploadData.ptv) {
        obj.ptvMessage = obj.videoMessage;
        delete obj.videoMessage;
    }
    if (cacheableKey) {
        logger === null || logger === void 0 ? void 0 : logger.debug({ cacheableKey }, 'set cache');
        options.mediaCache.set(cacheableKey, Types_1.WAProto.Message.encode(obj).finish());
    }
    return obj;
};
exports.prepareWAMessageMedia = prepareWAMessageMedia;

const prepareAlbumMessageContent = async (jid, albums, options) => {
    if (!Array.isArray(albums)) {
        throw new Error("albums must be an array containing media objects.");
    }
    if (albums.length === 0) {
        throw new Error("albums cannot be empty. At least one media item is required.");
    }
    const validCount = albums.filter((m) => "image" in m || "video" in m).length;
    if (validCount === 0) {
        throw new Error("albums contains no valid media. Use 'image' or 'video' keys.");
    }
    let mediaHandle;
    let mediaMsg;
    const message = [];
    const albumMsg = (0, exports.generateWAMessageFromContent)(jid, {
        albumMessage: {
            expectedImageCount: albums.filter((item) => "image" in item).length,
            expectedVideoCount: albums.filter((item) => "video" in item).length,
        },
    }, options);
    await options.conn.relayMessage(jid, albumMsg.message, { messageId: albumMsg.key.id });
    for (const media of albums) {
        let content = {};
        if ("image" in media) {
            content = { image: media.image };
        } else if ("video" in media) {
            content = { video: media.video };
        } else {
            continue;
        }
        mediaMsg = await (0, exports.generateWAMessage)(jid, { ...content, ...media }, {
            userJid: options.userJid,
            upload: async (encFilePath, opts) => {
                const up = await options.conn.waUploadToServer(encFilePath, { ...opts, newsletter: (0, WABinary_1.isJidNewsLetter)(jid) });
                mediaHandle = up.handle;
                return up;
            },
            ...options,
        });
        if (mediaMsg) {
            mediaMsg.message.messageContextInfo = {
                messageSecret: (0, crypto_1.randomBytes)(32),
                messageAssociation: {
                    associationType: WAProto_1.proto.MessageAssociation.AssociationType.MEDIA_ALBUM,
                    parentMessageKey: albumMsg.key,
                },
            };
        }
        message.push(mediaMsg);
    }
    return message;
};
exports.prepareAlbumMessageContent = prepareAlbumMessageContent;

const prepareDisappearingMessageSettingContent = (ephemeralExpiration) => {
    ephemeralExpiration = ephemeralExpiration || 0;
    const content = {
        ephemeralMessage: {
            message: {
                protocolMessage: {
                    type: Types_1.WAProto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING,
                    ephemeralExpiration
                }
            }
        }
    };
    return Types_1.WAProto.Message.fromObject(content);
};
exports.prepareDisappearingMessageSettingContent = prepareDisappearingMessageSettingContent;

const generateForwardMessageContent = (message, forceForward) => {
    var _a;
    let content = message.message;
    if (!content) {
        throw new boom_1.Boom('no content in message', { statusCode: 400 });
    }
    content = (0, exports.normalizeMessageContent)(content);
    content = WAProto_1.proto.Message.decode(WAProto_1.proto.Message.encode(content).finish());
    let key = Object.keys(content)[0];
    let score = ((_a = content[key].contextInfo) === null || _a === void 0 ? void 0 : _a.forwardingScore) || 0;
    score += message.key.fromMe && !forceForward ? 0 : 1;
    if (key === 'conversation') {
        content.extendedTextMessage = { text: content[key] };
        delete content.conversation;
        key = 'extendedTextMessage';
    }
    if (score > 0) {
        content[key].contextInfo = { forwardingScore: score, isForwarded: true };
    }
    else {
        content[key].contextInfo = {};
    }
    return content;
};
exports.generateForwardMessageContent = generateForwardMessageContent;

const generateWAMessageContent = async (message, options) => {
    var _a, _b;
    let m = {};
    if ('text' in message) {
        const extContent = { text: message.text };
        let urlInfo = message.linkPreview;
        if (typeof urlInfo === 'undefined') {
            urlInfo = await (0, exports.generateLinkPreviewIfRequired)(message.text, options.getUrlInfo, options.logger);
        }
        if (urlInfo) {
            extContent.canonicalUrl = urlInfo['canonical-url'];
            extContent.matchedText = urlInfo['matched-text'];
            extContent.jpegThumbnail = urlInfo.jpegThumbnail;
            extContent.description = urlInfo.description;
            extContent.title = urlInfo.title;
            extContent.previewType = 0;
            const img = urlInfo.highQualityThumbnail;
            if (img) {
                extContent.thumbnailDirectPath = img.directPath;
                extContent.mediaKey = img.mediaKey;
                extContent.mediaKeyTimestamp = img.mediaKeyTimestamp;
                extContent.thumbnailWidth = img.width;
                extContent.thumbnailHeight = img.height;
                extContent.thumbnailSha256 = img.fileSha256;
                extContent.thumbnailEncSha256 = img.fileEncSha256;
            }
        }
        if (options.backgroundColor) {
            extContent.backgroundArgb = await assertColor(options.backgroundColor);
        }
        if (options.textColor) {
            extContent.textArgb = await assertColor(options.textColor);
        }
        if (options.font) {
            extContent.font = options.font;
        }
        m.extendedTextMessage = extContent;
    }
    else if ('contacts' in message) {
        const contactLen = message.contacts.contacts.length;
        if (!contactLen) {
            throw new boom_1.Boom('require atleast 1 contact', { statusCode: 400 });
        }
        if (contactLen === 1) {
            m.contactMessage = Types_1.WAProto.Message.ContactMessage.fromObject(message.contacts.contacts[0]);
        }
        else {
            m.contactsArrayMessage = Types_1.WAProto.Message.ContactsArrayMessage.fromObject(message.contacts);
        }
    }
    else if ('location' in message) {
        if (message.location?.jpegThumbnail && !Buffer.isBuffer(message.location.jpegThumbnail)) {
            message.location.jpegThumbnail = await processLocationThumbnail(message.location.jpegThumbnail);
        }
        if (message.live) {
            m.liveLocationMessage = Types_1.WAProto.Message.LiveLocationMessage.fromObject(message.location);
        } else {
            m.locationMessage = Types_1.WAProto.Message.LocationMessage.fromObject(message.location);
        }
    }
    else if ('buttonsMessage' in message) {
        const btnMsg = { ...message.buttonsMessage };
        if (btnMsg.locationMessage?.jpegThumbnail && !Buffer.isBuffer(btnMsg.locationMessage.jpegThumbnail)) {
            btnMsg.locationMessage.jpegThumbnail = await processLocationThumbnail(btnMsg.locationMessage.jpegThumbnail);
        }
        m = { buttonsMessage: btnMsg };
    }
    else if ('react' in message) {
        if (!message.react.senderTimestampMs) {
            message.react.senderTimestampMs = Date.now();
        }
        m.reactionMessage = Types_1.WAProto.Message.ReactionMessage.fromObject(message.react);
    }
    else if ('delete' in message) {
        m.protocolMessage = {
            key: message.delete,
            type: Types_1.WAProto.Message.ProtocolMessage.Type.REVOKE
        };
    }
    else if ('forward' in message) {
        m = (0, exports.generateForwardMessageContent)(message.forward, message.force);
    }
    else if ('disappearingMessagesInChat' in message) {
        const exp = typeof message.disappearingMessagesInChat === 'boolean' ?
            (message.disappearingMessagesInChat ? Defaults_1.WA_DEFAULT_EPHEMERAL : 0) :
            message.disappearingMessagesInChat;
        m = (0, exports.prepareDisappearingMessageSettingContent)(exp);
    }
    else if ('groupInvite' in message) {
        m.groupInviteMessage = {
            inviteCode: message.groupInvite.code,
            inviteExpiration: message.groupInvite.expiration,
            caption: message.groupInvite.caption,
            groupJid: message.groupInvite.jid,
            groupName: message.groupInvite.name,
            contextInfo: message.contextInfo
        };
        if (options.getProfilePicUrl) {
            const pfpUrl = await options.getProfilePicUrl(message.groupInvite.jid);
            const { thumbnail } = await (0, messages_media_1.generateThumbnail)(pfpUrl, "image");
            m.groupInviteMessage.jpegThumbnail = thumbnail;
        }
    }
    else if ('adminInvite' in message) {
        m.newsletterAdminInviteMessage = {
            newsletterJid: message.adminInvite.jid,
            newsletterName: message.adminInvite.name,
            caption: message.adminInvite.caption,
            inviteExpiration: message.adminInvite.expiration,
            contextInfo: message.contextInfo
        };
        if (options.getProfilePicUrl) {
            const pfpUrl = await options.getProfilePicUrl(message.adminInvite.jid);
            const { thumbnail } = await (0, messages_media_1.generateThumbnail)(pfpUrl, "image");
            m.newsletterAdminInviteMessage.jpegThumbnail = thumbnail;
        }
    }
    else if ('keep' in message) {
        m.keepInChatMessage = {
            key: message.keep.key,
            keepType: message.keep?.type || 1,
            timestampMs: message.keep?.time || Date.now()
        };
    }
    else if ('call' in message) {
        m.scheduledCallCreationMessage = {
            scheduledTimestampMs: message.call?.time || Date.now(),
            callType: message.call?.type || 1,
            title: message.call?.name || "Call Creation"
        };
    }
    else if ('paymentInvite' in message) {
        m.messageContextInfo = {};
        m.paymentInviteMessage = {
            expiryTimestamp: message.paymentInvite?.expiry || 0,
            serviceType: message.paymentInvite?.type || 2
        };
    }
    else if ('orderStatus' in message) {
        const os = message.orderStatus;
        if (!os.image) throw new Error("image is required for orderStatus");
        let imageInput = os.image;
        if (typeof imageInput === 'string' && !imageInput.startsWith('http://') && !imageInput.startsWith('https://')) {
            imageInput = await fs_1.promises.readFile(imageInput);
        }
        const media = await (0, exports.prepareWAMessageMedia)({ image: imageInput }, { upload: options.upload, ...options });
        m = {
            viewOnceMessage: {
                message: {
                    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                    interactiveMessage: WAProto_1.proto.Message.InteractiveMessage.create({
                        header: { title: os.title || "Order Status", hasMediaAttachment: true, ...media },
                        body: { text: os.text || "Silakan cek status pesanan Anda." },
                        footer: { text: os.footer || "Powered by LevviCode" },
                        nativeFlowMessage: {
                            buttons: [{
                                name: "order_status",
                                buttonParamsJson: JSON.stringify({
                                    reference_id: os.referenceId || "LV-001",
                                    order: {
                                        status: os.status || "PROCESSING",
                                        subtotal: { value: os.subtotalValue || 0, offset: os.subtotalOffset || 100 },
                                        tax: { value: os.taxValue || 0, offset: os.taxOffset || 100 },
                                        currency: os.currency || "IDR"
                                    }
                                })
                            }]
                        }
                    })
                }
            }
        };
    }
    else if ('ptv' in message) {
        const { videoMessage } = await (0, exports.prepareWAMessageMedia)({ video: message.video }, options);
        m.ptvMessage = videoMessage;
    }
    else if ('order' in message) {
        m.orderMessage = Types_1.WAProto.Message.OrderMessage.fromObject(message.order);
    }
    else if ('product' in message) {
        const { imageMessage } = await (0, exports.prepareWAMessageMedia)({ image: message.product.productImage }, options);
        m.productMessage = Types_1.WAProto.Message.ProductMessage.fromObject({
            ...message,
            product: { ...message.product, productImage: imageMessage }
        });
    }
    else if ('album' in message) {
        const imageMessages = message.album.filter((item) => "image" in item);
        const videoMessages = message.album.filter((item) => "video" in item);
        m.albumMessage = Types_1.WAProto.Message.AlbumMessage.fromObject({
            expectedImageCount: imageMessages.length,
            expectedVideoCount: videoMessages.length,
        });
    }
    else if ('event' in message) {
        m.eventMessage = Types_1.WAProto.Message.EventMessage.fromObject(message.event);
        if (!message.event.startTime) {
            m.eventMessage.startTime = (0, generics_1.unixTimestampSeconds)() + 86400;
        }
        if (options.getCallLink && message.event.call) {
            const link = await options.getCallLink(message.event.call, m.eventMessage.startTime);
            m.eventMessage.joinLink = link;
        }
    }
    else if ('pollResult' in message) {
        if (!Array.isArray(message.pollResult.values)) {
            throw new boom_1.Boom("Invalid pollResult values", { statusCode: 400 });
        }
        m.pollResultSnapshotMessage = {
            name: message.pollResult.name,
            pollVotes: message.pollResult.values.map(([optionName, optionVoteCount]) => ({ optionName, optionVoteCount }))
        };
    }
    else if ('poll' in message) {
        (_b = message.poll).selectableCount || (_b.selectableCount = 0);
        if (!Array.isArray(message.poll.values)) {
            throw new boom_1.Boom('Invalid poll values', { statusCode: 400 });
        }
        if (message.poll.selectableCount < 0 || message.poll.selectableCount > message.poll.values.length) {
            throw new boom_1.Boom(`poll.selectableCount in poll should be >= 0 and <= ${message.poll.values.length}`, { statusCode: 400 });
        }
        const pollCreationMessage = {
            name: message.poll.name,
            selectableOptionsCount: message.poll.selectableCount,
            options: message.poll.values.map(optionName => ({ optionName })),
        };
        m.messageContextInfo = { messageSecret: message.poll.messageSecret || (0, crypto_1.randomBytes)(32) };
        if (message.poll?.toAnnouncementGroup) {
            m.pollCreationMessageV2 = pollCreationMessage;
        } else {
            if (message.poll.selectableCount > 0) {
                m.pollCreationMessageV3 = pollCreationMessage;
            } else {
                m.pollCreationMessage = pollCreationMessage;
            }
        }
    }
    else if ('payment' in message) {
        m.requestPaymentMessage = {
            amount: { currencyCode: message.payment?.currency || "IDR", offset: message.payment?.offset || 0, value: message.payment?.amount || 999999999 },
            expiryTimestamp: message.payment?.expiry || 0,
            amount1000: message.payment?.amount || 999999999 * 1e3,
            currencyCodeIso4217: message.payment?.currency || "IDR",
            requestFrom: message.payment?.from || "0@s.whatsapp.net",
            noteMessage: { extendedTextMessage: { text: message.payment?.note || "Notes" } },
            background: { placeholderArgb: message.payment?.image?.placeholderArgb || 4278190080, textArgb: message.payment?.image?.textArgb || 4294967295, subtextArgb: message.payment?.image?.subtextArgb || 4294967295, type: 1 }
        };
    }
    else if ('stickerPack' in message) {
        const { stickers, cover, name, publisher, packId, description } = message.stickerPack;
        const { zip } = require("fflate");
        const stickerData = {};
        const stickerPromises = stickers.map(async (s, i) => {
            const { stream } = await (0, messages_media_1.getStream)(s.sticker);
            const buffer = await (0, messages_media_1.toBuffer)(stream);
            const hash = (0, crypto_2.sha256)(buffer).toString("base64url");
            const fileName = `${i.toString().padStart(2, "0")}_${hash}.webp`;
            stickerData[fileName] = [new Uint8Array(buffer), { level: 0 }];
            return { fileName, mimetype: "image/webp", isAnimated: s.isAnimated || false, isLottie: s.isLottie || false, emojis: s.emojis || [], accessibilityLabel: s.accessibilityLabel || "" };
        });
        const stickerMetadata = await Promise.all(stickerPromises);
        const zipBuffer = await new Promise((resolve, reject) => {
            zip(stickerData, (err, data) => { err ? reject(err) : resolve(Buffer.from(data)); });
        });
        const coverBuffer = await (0, messages_media_1.toBuffer)((await (0, messages_media_1.getStream)(cover)).stream);
        const [stickerPackUpload, coverUpload] = await Promise.all([
            (0, messages_media_1.encryptedStream)(zipBuffer, "sticker-pack", { logger: options.logger, opts: options.options }),
            (0, exports.prepareWAMessageMedia)({ image: coverBuffer }, { ...options, mediaTypeOverride: "image" }),
        ]);
        const stickerPackUploadResult = await options.upload(stickerPackUpload.encFilePath, {
            fileEncSha256B64: stickerPackUpload.fileEncSha256.toString("base64"),
            mediaType: "sticker-pack",
            timeoutMs: options.mediaUploadTimeoutMs,
        });
        const coverImage = coverUpload.imageMessage;
        const imageDataHash = (0, crypto_2.sha256)(coverBuffer).toString("base64");
        const stickerPackId = packId || (0, generics_1.generateMessageID)();
        m.stickerPackMessage = {
            name, publisher, stickerPackId, packDescription: description,
            stickerPackOrigin: Types_1.WAProto.Message.StickerPackMessage.StickerPackOrigin.THIRD_PARTY,
            stickerPackSize: stickerPackUpload.fileLength, stickers: stickerMetadata,
            fileSha256: stickerPackUpload.fileSha256, fileEncSha256: stickerPackUpload.fileEncSha256,
            mediaKey: stickerPackUpload.mediaKey, directPath: stickerPackUploadResult.directPath,
            fileLength: stickerPackUpload.fileLength, mediaKeyTimestamp: (0, generics_1.unixTimestampSeconds)(),
            trayIconFileName: `${stickerPackId}.png`, imageDataHash,
            thumbnailDirectPath: coverImage.directPath, thumbnailFileSha256: coverImage.fileSha256,
            thumbnailFileEncSha256: coverImage.fileEncSha256, thumbnailHeight: coverImage.height, thumbnailWidth: coverImage.width,
        };
    }
    else if ('richMessage' in message) {
        const rich = message.richMessage;
        const submessages = [];
        const sections = [];
        const richResponseSources = [];
        const extractIE = (text) => {
            let ie = [], result = '', last = 0, citation_index = 1, hyperlink_index = 0, latex_index = 0, stack = [];
            for (let i = 0; i < text.length; i++) {
                if (text[i] == '[' && text[i - 1] != '\\') { stack.push(i); }
                else if (text[i] == ']' && (text[i + 1] == '(' || text[i + 1] == '<')) {
                    let start = stack.pop(); if (start == null) continue;
                    let open = text[i + 1], close = open == '(' ? ')' : '>', type = open == '(' ? 'link' : 'latex', end = i + 2, depth = 1;
                    while (end < text.length && depth) {
                        if (text[end] == open && text[end - 1] != '\\') depth++;
                        else if (text[end] == close && text[end - 1] != '\\') depth--;
                        end++;
                    }
                    if (depth) continue;
                    let raw = text.slice(start + 1, i).trim(), url = text.slice(i + 2, end - 1).trim(), key, tag, data;
                    if (type == 'latex') {
                        let [txt = '', width = null, height = null, font_height = null, padding = null] = raw.split('|');
                        key = `LATEX_${latex_index++}`; tag = `{{${key}}}${txt || 'image'}{{/${key}}}`;
                        data = { type: 'latex', ie: { key, text: txt, url, width, height, font_height, padding } };
                    } else if (raw) {
                        key = `HLINK_${hyperlink_index++}`; tag = `{{${key}}}${url}{{/${key}}}`;
                        data = { type: 'hyperlink', ie: { key, text: raw, url } };
                    } else {
                        key = `CITE_${citation_index - 1}`; tag = `{{${key}}}${url}{{/${key}}}`;
                        data = { type: 'citation', ie: { reference_id: citation_index++, key, text: '', url } };
                    }
                    result += text.slice(last, start) + tag; last = end; ie.push(data); i = end - 1;
                }
            }
            result += text.slice(last); return { text: result, ie };
        };
        const tokenizer = (code, lang = 'javascript') => {
            const keywordsMap = { javascript: new Set(['break','case','catch','continue','debugger','delete','do','else','finally','for','function','if','in','instanceof','new','return','switch','this','throw','try','typeof','var','void','while','with','true','false','null','undefined','class','const','let','super','extends','export','import','yield','static','constructor','async','await','get','set']) };
            const TYPE_MAP = { 0:'DEFAULT', 1:'KEYWORD', 2:'METHOD', 3:'STR', 4:'NUMBER', 5:'COMMENT' };
            const keywords = keywordsMap[lang] || new Set(); const tokens = []; let i = 0;
            const push = (content, type) => {
                if (!content) return; const last = tokens[tokens.length - 1];
                if (last && last.highlightType === type) last.codeContent += content; else tokens.push({ codeContent: content, highlightType: type });
            };
            while (i < code.length) {
                const c = code[i];
                if (/\s/.test(c)) { let s = i; while (i < code.length && /\s/.test(code[i])) i++; push(code.slice(s, i), 0); continue; }
                if (c === '/' && code[i + 1] === '/') { let s = i; i += 2; while (i < code.length && code[i] !== '\n') i++; push(code.slice(s, i), 5); continue; }
                if (c === '"' || c === "'" || c === '`') { let s = i; const q = c; i++; while (i < code.length) { if (code[i] === '\\' && i + 1 < code.length) i += 2; else if (code[i] === q) { i++; break; } else i++; } push(code.slice(s, i), 3); continue; }
                if (/[0-9]/.test(c)) { let s = i; while (i < code.length && /[0-9.]/.test(code[i])) i++; push(code.slice(s, i), 4); continue; }
                if (/[a-zA-Z_$]/.test(c)) { let s = i; while (i < code.length && /[a-zA-Z0-9_$]/.test(code[i])) i++; const word = code.slice(s, i); let type = 0; if (keywords.has(word)) type = 1; else { let j = i; while (j < code.length && /\s/.test(code[j])) j++; if (code[j] === '(') type = 2; } push(word, type); continue; }
                push(c, 0); i++;
            }
            return { codeBlock: tokens, unified_codeBlock: tokens.map(t => ({ content: t.codeContent, type: TYPE_MAP[t.highlightType] })) };
        };
        const toTableMetadata = (arr) => {
            const [header, ...rows] = arr; const maxLen = Math.max(header.length, ...rows.map(r => r.length));
            const normalize = (r) => [...r, ...Array(maxLen - r.length).fill('')];
            const unified_rows = [{ is_header: true, cells: normalize(header) }, ...rows.map(r => ({ is_header: false, cells: normalize(r) }))];
            const rowsMeta = unified_rows.map(r => ({ items: r.cells, ...(r.is_header ? { isHeading: true } : {}) }));
            return { title: '', rows: rowsMeta, unified_rows };
        };
        if (rich.text) {
            const parsed = typeof rich.text === 'string' ? extractIE(rich.text) : rich.text; const text = parsed.text || parsed;
            const inline_entities = parsed.ie ? parsed.ie.map(({ type, ie }) => {
                if (type === 'hyperlink') return { key: ie.key, metadata: { display_name: ie.text, is_trusted: true, url: ie.url, __typename: 'GenAIInlineLinkItem' } };
                if (type === 'citation') return { key: ie.key, metadata: { reference_id: ie.reference_id, reference_url: ie.url, reference_title: ie.url, reference_display_name: ie.url, sources: [], __typename: 'GenAISearchCitationItem' } };
                if (type === 'latex') return { key: ie.key, metadata: { latex_expression: ie.text || '', latex_image: { url: ie.url, width: Number(ie.width) || 100, height: Number(ie.height) || 100 }, font_height: Number(ie.font_height) || 83.33, padding: Number(ie.padding) || 15, __typename: 'GenAILatexItem' } };
                return null;
            }).filter(Boolean) : [];
            submessages.push({ messageType: 2, messageText: text });
            sections.push({ view_model: { primitive: { text, inline_entities, __typename: 'GenAIMarkdownTextUXPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } });
        }
        if (rich.code) {
            const { language, code } = rich.code; const tok = tokenizer(code, language);
            submessages.push({ messageType: 5, codeMetadata: { codeLanguage: language, codeBlocks: tok.codeBlock } });
            sections.push({ view_model: { primitive: { language, code_blocks: tok.unified_codeBlock, __typename: 'GenAICodeUXPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } });
        }
        if (rich.table) {
            const meta = toTableMetadata(rich.table);
            submessages.push({ messageType: 4, tableMetadata: { title: meta.title, rows: meta.rows } });
            sections.push({ view_model: { primitive: { rows: meta.unified_rows, __typename: 'GenATableUXPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } });
        }
        if (rich.images) {
            const urls = Array.isArray(rich.images) ? rich.images : [rich.images];
            submessages.push({ messageType: 1, gridImageMetadata: { gridImageUrl: { imagePreviewUrl: urls[0] }, imageUrls: urls.map(url => ({ imagePreviewUrl: url, imageHighResUrl: url, sourceUrl: 'https://www.levvicode.cloud/' })) } });
            urls.forEach(url => { sections.push({ view_model: { primitive: { media: { url, mime_type: 'image/jpeg' }, imagine_type: 3, status: { status: 'READY' }, __typename: 'GenAIImaginePrimitive' }, __typename: 'GenAISingleLayoutViewModel' } }); });
        }
        if (rich.video) {
            submessages.push({ messageType: 2, messageText: '[ CANNOT_LOAD_VIDEO - LevviCode ]' });
            sections.push({ view_model: { primitive: { media: { url: rich.video, mime_type: 'video/mp4', duration: 10 }, imagine_type: 'ANIMATE', status: { status: 'READY' }, __typename: 'GenAIImaginePrimitive' }, __typename: 'GenAISingleLayoutViewModel' } });
        }
        if (rich.productSingle) {
            submessages.push({ messageType: 2, messageText: '[ CANNOT_LOAD_PRODUCT - LevviCode ]' });
            sections.push({ view_model: { primitive: { ...rich.productSingle, __typename: 'GenAIProductItemCardPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } });
        }
        if (rich.productMultiple) {
            submessages.push({ messageType: 2, messageText: '[ CANNOT_LOAD_PRODUCT - LevviCode ]' });
            sections.push({ view_model: { primitives: rich.productMultiple.map(p => ({ ...p, __typename: 'GenAIProductItemCardPrimitive' })), __typename: 'GenAIHScrollLayoutViewModel' } });
        }
        if (rich.product && !rich.productSingle && !rich.productMultiple) {
            submessages.push({ messageType: 2, messageText: '[ CANNOT_LOAD_PRODUCT - LevviCode ]' });
            if (Array.isArray(rich.product)) {
                sections.push({ view_model: { primitives: rich.product.map(p => ({ ...p, __typename: 'GenAIProductItemCardPrimitive' })), __typename: 'GenAIHScrollLayoutViewModel' } });
            } else {
                sections.push({ view_model: { primitive: { ...rich.product, __typename: 'GenAIProductItemCardPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } });
            }
        }
        if (rich.post) {
            submessages.push({ messageType: 2, messageText: '[ CANNOT_LOAD_POST - LevviCode ]' });
            if (Array.isArray(rich.post)) {
                sections.push({ view_model: { primitives: rich.post.map(p => ({ ...p, __typename: 'GenAIPostPrimitive' })), __typename: 'GenAIHScrollLayoutViewModel' } });
            } else {
                sections.push({ view_model: { primitive: { ...rich.post, __typename: 'GenAIPostPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } });
            }
        }
        if (rich.reels) {
            const items = Array.isArray(rich.reels) ? rich.reels : [rich.reels];
            submessages.push({ messageType: 9, contentItemsMetadata: { contentType: 1, itemsMetadata: items.map(i => ({ reelItem: { title: i.title, profileIconUrl: i.profileIconUrl, thumbnailUrl: i.thumbnailUrl, videoUrl: i.videoUrl } })) } });
            sections.push({ view_model: { primitives: items.map(i => ({ reels_url: i.videoUrl, thumbnail_url: i.thumbnailUrl, creator: i.title, avatar_url: i.profileIconUrl, reels_title: i.reels_title || '', likes_count: i.likes_count || 0, shares_count: i.shares_count || 0, view_count: i.view_count || 0, reel_source: i.reel_source || 'IG', is_verified: i.is_verified || false, __typename: 'GenAIReelPrimitive' })), __typename: 'GenAIHScrollLayoutViewModel' } });
            items.forEach((i, idx) => richResponseSources.push({ provider: 'LevviCode', thumbnailCDNURL: i.thumbnailUrl, sourceProviderURL: i.videoUrl, sourceQuery: '', faviconCDNURL: i.profileIconUrl, citationNumber: idx + 1, sourceTitle: i.title }));
        }
        if (rich.sources) {
            const sourceArr = Array.isArray(rich.sources) ? rich.sources : [rich.sources];
            sections.push({ view_model: { primitive: { sources: sourceArr.map(s => typeof s === 'object' ? s : { source_type: 'THIRD_PARTY', source_display_name: s[2] || '', source_subtitle: 'AI', source_url: s[1] || '', favicon: { url: s[0] || '', mime_type: 'image/jpeg', width: 16, height: 16 } }), __typename: 'GenAISearchResultPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } });
        }
        if (rich.tip) {
            submessages.push({ messageType: 2, messageText: rich.tip });
            sections.push({ view_model: { primitive: { text: rich.tip, __typename: 'GenAIMetadataTextPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } });
        }
        if (rich.suggestions) {
            sections.push({ view_model: { primitives: rich.suggestions.map(s => ({ prompt_text: s, prompt_type: 'SUGGESTED_PROMPT', __typename: 'GenAIFollowUpSuggestionPillPrimitive' })), __typename: 'GenAIActionRowLayoutViewModel' } });
        }
        if (rich.footer) {
            sections.push({ view_model: { primitive: { text: rich.footer, __typename: 'GenAIMetadataTextPrimitive' }, __typename: 'GenAISingleLayoutViewModel' } });
        }
        const unifiedData = { response_id: (0, crypto_1.randomUUID)(), sections };
        m = {
            messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2, botMetadata: { messageDisclaimerText: rich.title || '', richResponseSourcesMetadata: { sources: richResponseSources } } },
            botForwardedMessage: {
                message: {
                    richResponseMessage: {
                        messageType: 1, submessages, unifiedResponse: { data: Buffer.from(JSON.stringify(unifiedData)).toString('base64') },
                        contextInfo: { forwardingScore: 1, isForwarded: true, forwardedAiBotMessageInfo: { botJid: '0@bot' }, forwardOrigin: 4 }
                    }
                }
            }
        };
    }
    else if ('listReply' in message) {
        m.listResponseMessage = { ...message.listReply };
    }
    else if ('sharePhoneNumber' in message) {
        m.protocolMessage = { type: WAProto_1.proto.Message.ProtocolMessage.Type.SHARE_PHONE_NUMBER };
    }
    else if ('requestPhoneNumber' in message) {
        m.requestPhoneNumberMessage = {};
    }
    else {
        m = await (0, exports.prepareWAMessageMedia)(message, options);
    }

    if ('buttonReply' in message) {
        switch (message.type) {
            case 'list':
                m.listResponseMessage = {
                    title: message.buttonReply.title,
                    description: message.buttonReply.description,
                    singleSelectReply: { selectedRowId: message.buttonReply.rowId },
                    listType: Types_1.WAProto.Message.ListResponseMessage.ListType.SINGLE_SELECT,
                };
                break;
            case 'template':
                m.templateButtonReplyMessage = {
                    selectedDisplayText: message.buttonReply.displayText,
                    selectedId: message.buttonReply.id,
                    selectedIndex: message.buttonReply.index,
                };
                break;
            case 'plain':
                m.buttonsResponseMessage = {
                    selectedButtonId: message.buttonReply.id,
                    selectedDisplayText: message.buttonReply.displayText,
                    type: WAProto_1.proto.Message.ButtonsResponseMessage.Type.DISPLAY_TEXT,
                };
                break;
            case 'interactive':
                m.interactiveResponseMessage = {
                    body: { text: message.buttonReply.displayText, format: Types_1.WAProto.Message.InteractiveResponseMessage.Body.Format.EXTENSIONS_1 },
                    nativeFlowResponseMessage: { name: message.buttonReply.nativeFlows.name, paramsJson: message.buttonReply.nativeFlows.paramsJson, version: message.buttonReply.nativeFlows.version }
                };
                break;
        }
    }
    else if ('sections' in message && !!message.sections) {
        m.listMessage = {
            title: message.title,
            buttonText: message.buttonText,
            footerText: message.footer,
            description: message.text,
            sections: message.sections,
            listType: WAProto_1.proto.Message.ListMessage.ListType.SINGLE_SELECT
        };
    }
    else if ('productList' in message) {
        const thumbnail = message.thumbnail ? await (0, messages_media_1.generateThumbnail)(message.thumbnail, "image") : null;
        m.listMessage = {
            title: message.title,
            buttonText: message.buttonText,
            footerText: message.footer,
            description: message.text,
            productListInfo: {
                productSections: message.productList,
                headerImage: { productId: message.productList[0].products[0].productId, jpegThumbnail: thumbnail?.thumbnail || null },
                businessOwnerJid: message.businessOwnerJid,
            },
            listType: WAProto_1.proto.Message.ListMessage.ListType.PRODUCT_LIST,
        };
    }
    else if ('buttons' in message && !!message.buttons) {
        const buttonsMessage = {
            buttons: message.buttons.map(b => ({ ...b, type: WAProto_1.proto.Message.ButtonsMessage.Button.Type.RESPONSE }))
        };
        if ('text' in message) {
            buttonsMessage.contentText = message.text;
            buttonsMessage.headerType = ButtonType.EMPTY;
        }
        else {
            if ('caption' in message) {
                buttonsMessage.contentText = message.caption;
            }
            const type = Object.keys(m)[0].replace('Message', '').toUpperCase();
            buttonsMessage.headerType = ButtonType[type];
            Object.assign(buttonsMessage, m);
        }
        if ('title' in message) {
            buttonsMessage.text = message.title;
            buttonsMessage.headerType = ButtonType.TEXT;
        }
        if ('footer' in message && !!message.footer) {
            buttonsMessage.footerText = message.footer;
        }
        m = { buttonsMessage };
    }
    else if ('templateButtons' in message && !!message.templateButtons) {
        const msg = { hydratedButtons: message.templateButtons };
        if ('text' in message) { msg.hydratedContentText = message.text; }
        else {
            if ('caption' in message) { msg.hydratedContentText = message.caption; }
            Object.assign(msg, m);
        }
        if ('footer' in message && !!message.footer) { msg.hydratedFooterText = message.footer; }
        m = { templateMessage: { hydratedTemplate: msg } };
    }
    else if ('interactiveButtons' in message) {
        const interactiveMessage = { nativeFlowMessage: { buttons: message.interactiveButtons } };
        if ('text' in message) { interactiveMessage.body = { text: message.text }; }
        if ('title' in message) {
            interactiveMessage.header = { title: message.title, subtitle: null, hasMediaAttachment: false };
            if ('subtitle' in message) { interactiveMessage.header.subtitle = message.subtitle; }
        } else {
            if ('caption' in message) {
                interactiveMessage.body = { text: message.caption };
                interactiveMessage.header = { title: null, subtitle: null, hasMediaAttachment: false, ...Object.assign(interactiveMessage, m) };
                if ('title' in message) { interactiveMessage.header.title = message.title; }
                if ('subtitle' in message) { interactiveMessage.header.subtitle = message.subtitle; }
                if ('hasMediaAttachment' in message) { interactiveMessage.header.hasMediaAttachment = Boolean(message.hasMediaAttachment); }
            }
        }
        if ('footer' in message) { interactiveMessage.footer = { text: message.footer }; }
        m = { interactiveMessage };
    }
    else if ('shop' in message) {
        const interactiveMessage = { shopStorefrontMessage: { surface: message.shop.surface, id: message.shop.id } };
        if ('text' in message) { interactiveMessage.body = { text: message.text }; }
        if ('title' in message) {
            interactiveMessage.header = { title: message.title, subtitle: null, hasMediaAttachment: false };
            if ('subtitle' in message) { interactiveMessage.header.subtitle = message.subtitle; }
        } else {
            if ('caption' in message) {
                interactiveMessage.body = { text: message.caption };
                interactiveMessage.header = { title: null, subtitle: null, hasMediaAttachment: false, ...Object.assign(interactiveMessage, m) };
                if ('title' in message) { interactiveMessage.header.title = message.title; }
                if ('subtitle' in message) { interactiveMessage.header.subtitle = message.subtitle; }
                if ('hasMediaAttachment' in message) { interactiveMessage.header.hasMediaAttachment = Boolean(message.hasMediaAttachment); }
            }
        }
        if ('footer' in message) { interactiveMessage.footer = { text: message.footer }; }
        m = { interactiveMessage };
    }
    else if ('collection' in message) {
        const interactiveMessage = { collectionMessage: { bizJid: message.collection.bizJid, id: message.collection.id, messageVersion: message?.collection?.version } };
        if ('text' in message) { interactiveMessage.body = { text: message.text }; }
        if ('title' in message) {
            interactiveMessage.header = { title: message.title, subtitle: null, hasMediaAttachment: false };
            if ('subtitle' in message) { interactiveMessage.header.subtitle = message.subtitle; }
        } else {
            if ('caption' in message) {
                interactiveMessage.body = { text: message.caption };
                interactiveMessage.header = { title: null, subtitle: null, hasMediaAttachment: false, ...Object.assign(interactiveMessage, m) };
                if ('title' in message) { interactiveMessage.header.title = message.title; }
                if ('subtitle' in message) { interactiveMessage.header.subtitle = message.subtitle; }
                if ('hasMediaAttachment' in message) { interactiveMessage.header.hasMediaAttachment = Boolean(message.hasMediaAttachment); }
            }
        }
        if ('footer' in message) { interactiveMessage.footer = { text: message.footer }; }
        m = { interactiveMessage };
    }
    else if ('cards' in message) {
        const slides = await Promise.all(message.cards.map(async (slide) => {
            const { image, video, product, title, body, footer, buttons } = slide; let header;
            if (product) {
                const { imageMessage } = await (0, exports.prepareWAMessageMedia)({ image: product.productImage, ...options }, options);
                header = { productMessage: { product: { ...product, productImage: imageMessage }, ...slide } };
            } else if (image) { header = await (0, exports.prepareWAMessageMedia)({ image, ...options }, options); }
            else if (video) { header = await (0, exports.prepareWAMessageMedia)({ video, ...options }, options); }
            return { header: { title, hasMediaAttachment: true, ...header }, body: { text: body }, footer: { text: footer }, nativeFlowMessage: { buttons } };
        }));
        const interactiveMessage = { carouselMessage: { cards: slides } };
        if ('text' in message) { interactiveMessage.body = { text: message.text }; }
        if ('title' in message) {
            interactiveMessage.header = { title: message.title, subtitle: null, hasMediaAttachment: false };
            if ('subtitle' in message) { interactiveMessage.header.subtitle = message.subtitle; }
        } else {
            if ('caption' in message) {
                interactiveMessage.body = { text: message.caption };
                interactiveMessage.header = { title: null, subtitle: null, hasMediaAttachment: false, ...Object.assign(interactiveMessage, m) };
                if ('title' in message) { interactiveMessage.header.title = message.title; }
                if ('subtitle' in message) { interactiveMessage.header.subtitle = message.subtitle; }
                if ('hasMediaAttachment' in message) { interactiveMessage.header.hasMediaAttachment = Boolean(message.hasMediaAttachment); }
            }
        }
        if ('footer' in message) { interactiveMessage.footer = { text: message.footer }; }
        m = { interactiveMessage };
    }
    if ('viewOnce' in message && !!message.viewOnce) {
        m = { viewOnceMessage: { message: m } };
    }
    if ('ephemeral' in message && !!message.ephemeral) {
        m = { ephemeralMessage: { message: m } };
    }
    if ('mentions' in message && ((_a = message.mentions) === null || _a === void 0 ? void 0 : _a.length)) {
        const [messageType] = Object.keys(m);
        m[messageType] = m[messageType] || {};
        m[messageType].contextInfo = m[messageType].contextInfo || {};
        m[messageType].contextInfo.mentionedJid = message.mentions;
    }
    if ('edit' in message) {
        m = {
            protocolMessage: {
                key: message.edit,
                editedMessage: m,
                timestampMs: Date.now(),
                type: Types_1.WAProto.Message.ProtocolMessage.Type.MESSAGE_EDIT
            }
        };
    }
    if ('contextInfo' in message && !!message.contextInfo) {
        const [messageType] = Object.keys(m);
        m[messageType] = m[messageType] || {};
        m[messageType].contextInfo = { ...(m[messageType].contextInfo || {}), ...message.contextInfo };
    }
    return Types_1.WAProto.Message.fromObject(m);
};
exports.generateWAMessageContent = generateWAMessageContent;

const generateWAMessageFromContent = (jid, message, options) => {
    if (!options.timestamp) {
        options.timestamp = new Date();
    }
    const innerMessage = (0, exports.normalizeMessageContent)(message);
    const key = (0, exports.getContentType)(innerMessage);
    const timestamp = (0, generics_1.unixTimestampSeconds)(options.timestamp);
    const threadId = [];
    const { quoted, userJid } = options;
    if (quoted && !(0, WABinary_1.isJidNewsLetter)(jid)) {
        const participant = quoted.key.fromMe ? userJid : (quoted.participant || quoted.key.participant || quoted.key.remoteJid);
        let quotedMsg = (0, exports.normalizeMessageContent)(quoted.message);
        const msgType = (0, exports.getContentType)(quotedMsg);
        quotedMsg = WAProto_1.proto.Message.fromObject({ [msgType]: quotedMsg[msgType] });
        const quotedContent = quotedMsg[msgType];
        if (typeof quotedContent === 'object' && quotedContent && 'contextInfo' in quotedContent) {
            delete quotedContent.contextInfo;
        }
        let requestPayment;
        if (key === "requestPaymentMessage") {
            if (innerMessage?.requestPaymentMessage?.noteMessage?.extendedTextMessage) {
                requestPayment = innerMessage.requestPaymentMessage.noteMessage.extendedTextMessage;
            } else if (innerMessage?.requestPaymentMessage?.noteMessage?.stickerMessage) {
                requestPayment = innerMessage.requestPaymentMessage.noteMessage.stickerMessage;
            }
        }
        const contextInfo = (key === "requestPaymentMessage" ? requestPayment?.contextInfo : innerMessage[key].contextInfo) || {};
        contextInfo.participant = (0, WABinary_1.jidNormalizedUser)(participant);
        contextInfo.stanzaId = quoted.key.id;
        contextInfo.quotedMessage = quotedMsg;
        if (jid !== quoted.key.remoteJid) {
            contextInfo.remoteJid = quoted.key.remoteJid;
        }
        if (contextInfo.quotedMessage) {
            contextInfo.quotedType = WAProto_1.proto.ContextInfo.QuotedType.EXPLICIT;
        }
        if (contextInfo.quotedMessage && (0, WABinary_1.isJidGroup)(jid)) {
            threadId.push({
                threadType: WAProto_1.proto.ThreadID.ThreadType.VIEW_REPLIES,
                threadKey: { remoteJid: quoted?.key?.remoteJid, fromMe: quoted?.key?.fromMe, id: (0, generics_1.generateMessageID)(), ...(quoted?.key?.fromMe ? {} : { participant: quoted?.key?.participant }) }
            });
        }
        if (key === "requestPaymentMessage" && requestPayment) {
            requestPayment.contextInfo = contextInfo;
        } else {
            innerMessage[key].contextInfo = contextInfo;
        }
    }
    if (key !== 'protocolMessage' && key !== 'ephemeralMessage' && !(0, WABinary_1.isJidNewsLetter)(jid)) {
        message.messageContextInfo = { threadId: threadId.length > 0 ? threadId : [], messageSecret: (0, crypto_1.randomBytes)(32), ...message.messageContextInfo };
        innerMessage[key].contextInfo = {
            ...(innerMessage[key].contextInfo || {}),
            expiration: options.ephemeralExpiration ? options.ephemeralExpiration : 0
        };
    }
    message = Types_1.WAProto.Message.fromObject(message);
    const messageJSON = {
        key: { remoteJid: jid, fromMe: true, id: (options === null || options === void 0 ? void 0 : options.messageId) || (0, generics_1.generateMessageID)() },
        message: message,
        messageTimestamp: timestamp,
        messageStubParameters: [],
        participant: (0, WABinary_1.isJidGroup)(jid) || (0, WABinary_1.isJidStatusBroadcast)(jid) ? userJid : undefined,
        status: Types_1.WAMessageStatus.PENDING
    };
    return Types_1.WAProto.WebMessageInfo.fromObject(messageJSON);
};
exports.generateWAMessageFromContent = generateWAMessageFromContent;

const generateWAMessage = async (jid, content, options) => {
    var _a;
    options.logger = (_a = options === null || options === void 0 ? void 0 : options.logger) === null || _a === void 0 ? void 0 : _a.child({ msgId: options.messageId });
    return (0, exports.generateWAMessageFromContent)(jid, await (0, exports.generateWAMessageContent)(content, { newsletter: (0, WABinary_1.isJidNewsLetter)(jid), ...options }), options);
};
exports.generateWAMessage = generateWAMessage;

const getContentType = (content) => {
    if (content) {
        const keys = Object.keys(content);
        const key = keys.find(k => (k === 'conversation' || k.endsWith('Message') || k.endsWith('V2') || k.endsWith('V3') || k.endsWith('V4')) && k !== 'senderKeyDistributionMessage' && k !== 'messageContextInfo');
        return key;
    }
};
exports.getContentType = getContentType;

const normalizeMessageContent = (content) => {
    if (!content) { return undefined; }
    for (let i = 0; i < 5; i++) {
        const inner = getFutureProofMessage(content);
        if (!inner) { break; }
        content = inner.message;
    }
    return content;
    function getFutureProofMessage(message) {
        return (message?.editedMessage || message?.statusAddYours || message?.botTaskMessage || message?.eventCoverImage || message?.questionMessage || message?.viewOnceMessage || message?.botInvokeMessage || message?.ephemeralMessage || message?.limitSharingMessage || message?.viewOnceMessageV2 || message?.lottieStickerMessage || message?.questionReplyMessage || message?.botForwardedMessage || message?.statusMentionMessage || message?.pollCreationMessageV4 || message?.associatedChildMessage || message?.groupMentionedMessage || message?.groupStatusMentionMessage || message?.viewOnceMessageV2Extension || message?.documentWithCaptionMessage || message?.pollCreationOptionImageMessage);
    }
};
exports.normalizeMessageContent = normalizeMessageContent;

const extractMessageContent = (content) => {
    const extractFromButtonsMessage = (msg) => {
        const header = typeof msg.header === "object" && msg.header !== null;
        if (header ? msg.header?.imageMessage : msg.imageMessage) { return { imageMessage: header ? msg.header.imageMessage : msg.imageMessage }; }
        else if (header ? msg.header?.documentMessage : msg.documentMessage) { return { documentMessage: header ? msg.header.documentMessage : msg.documentMessage }; }
        else if (header ? msg.header?.videoMessage : msg.videoMessage) { return { videoMessage: header ? msg.header.videoMessage : msg.videoMessage }; }
        else if (header ? msg.header?.locationMessage : msg.locationMessage) { return { locationMessage: header ? msg.header.locationMessage : msg.locationMessage }; }
        else if (header ? msg.header?.productMessage : msg.productMessage) { return { productMessage: header ? msg.header.productMessage : msg.productMessage }; }
        else { return { conversation: "contentText" in msg ? msg.contentText : "hydratedContentText" in msg ? msg.hydratedContentText : "body" in msg ? msg.body.text : "" }; }
    };
    content = (0, exports.normalizeMessageContent)(content);
    if (content?.buttonsMessage) { return extractFromButtonsMessage(content.buttonsMessage); }
    if (content?.interactiveMessage) { return extractFromButtonsMessage(content.interactiveMessage); }
    if (content?.templateMessage?.interactiveMessageTemplate) { return extractFromButtonsMessage(content?.templateMessage?.interactiveMessageTemplate); }
    if (content?.templateMessage?.hydratedFourRowTemplate) { return extractFromButtonsMessage(content?.templateMessage?.hydratedFourRowTemplate); }
    if (content?.templateMessage?.hydratedTemplate) { return extractFromButtonsMessage(content?.templateMessage?.hydratedTemplate); }
    if (content?.templateMessage?.fourRowTemplate) { return extractFromButtonsMessage(content?.templateMessage?.fourRowTemplate); }
    return content;
};
exports.extractMessageContent = extractMessageContent;

const getDevice = (id) => /^3A.{18}$/.test(id) ? 'ios' : /^3E.{20}$/.test(id) ? 'web' : /^(.{21}|.{32})$/.test(id) ? 'android' : /^(3F|.{18}$)/.test(id) ? 'desktop' : 'baileys';
exports.getDevice = getDevice;

const updateMessageWithReceipt = (msg, receipt) => {
    msg.userReceipt = msg.userReceipt || [];
    const recp = msg.userReceipt.find(m => m.userJid === receipt.userJid);
    if (recp) { Object.assign(recp, receipt); }
    else { msg.userReceipt.push(receipt); }
};
exports.updateMessageWithReceipt = updateMessageWithReceipt;

const updateMessageWithReaction = (msg, reaction) => {
    const authorID = (0, generics_1.getKeyAuthor)(reaction.key);
    const reactions = (msg.reactions || []).filter(r => (0, generics_1.getKeyAuthor)(r.key) !== authorID);
    reaction.text = reaction.text || "";
    reactions.push(reaction);
    msg.reactions = reactions;
};
exports.updateMessageWithReaction = updateMessageWithReaction;

const updateMessageWithPollUpdate = (msg, update) => {
    const authorID = (0, generics_1.getKeyAuthor)(update.pollUpdateMessageKey);
    const votes = (msg.pollUpdates || []).filter(r => (0, generics_1.getKeyAuthor)(r.pollUpdateMessageKey) !== authorID);
    if (update.vote?.selectedOptions?.length) { votes.push(update); }
    msg.pollUpdates = votes;
};
exports.updateMessageWithPollUpdate = updateMessageWithPollUpdate;

const updateMessageWithEventResponse = (msg, update) => {
    const authorID = (0, generics_1.getKeyAuthor)(update.eventResponseMessageKey);
    const responses = (msg.eventResponses || []).filter(r => (0, generics_1.getKeyAuthor)(r.eventResponseMessageKey) !== authorID);
    responses.push(update);
    msg.eventResponses = responses;
};
exports.updateMessageWithEventResponse = updateMessageWithEventResponse;

function getAggregateVotesInPollMessage({ message, pollUpdates }, meId) {
    message = (0, exports.normalizeMessageContent)(message);
    const opts = message?.pollCreationMessage?.options || message?.pollCreationMessageV2?.options || message?.pollCreationMessageV3?.options || [];
    const voteHashMap = opts.reduce((acc, opt) => {
        const hash = (0, crypto_2.sha256)(Buffer.from(opt.optionName || '')).toString();
        acc[hash] = { name: opt.optionName || '', voters: [] }; return acc;
    }, {});
    for (const update of pollUpdates || []) {
        const { vote } = update; if (!vote) continue;
        for (const option of vote.selectedOptions || []) {
            const hash = option.toString(); let data = voteHashMap[hash];
            if (!data) { voteHashMap[hash] = { name: 'Unknown', voters: [] }; data = voteHashMap[hash]; }
            voteHashMap[hash].voters.push((0, generics_1.getKeyAuthor)(update.pollUpdateMessageKey, meId));
        }
    }
    return Object.values(voteHashMap);
}
exports.getAggregateVotesInPollMessage = getAggregateVotesInPollMessage;

function getAggregateResponsesInEventMessage({ eventResponses }, meLid) {
    const responseTypes = ["GOING", "NOT_GOING", "MAYBE"]; const responseMap = {};
    for (const type of responseTypes) { responseMap[type] = { response: type, responders: [] }; }
    for (const update of eventResponses || []) {
        const { response } = update.response || 0;
        const responseType = WAProto_1.proto.Message.EventResponseMessage.EventResponseType[response];
        if (responseType !== "UNKNOWN" && responseMap[responseType]) {
            responseMap[responseType].responders.push((0, generics_1.getKeyAuthor)(update.eventResponseMessageKey, meLid));
        }
    }
    return Object.values(responseMap);
}
exports.getAggregateResponsesInEventMessage = getAggregateResponsesInEventMessage;

const aggregateMessageKeysNotFromMe = (keys) => {
    const keyMap = {};
    for (const { remoteJid, id, participant, fromMe } of keys) {
        if (!fromMe) {
            const uqKey = `${remoteJid}:${participant || ''}`;
            if (!keyMap[uqKey]) { keyMap[uqKey] = { jid: remoteJid, participant: participant, messageIds: [] }; }
            keyMap[uqKey].messageIds.push(id);
        }
    }
    return Object.values(keyMap);
};
exports.aggregateMessageKeysNotFromMe = aggregateMessageKeysNotFromMe;

const REUPLOAD_REQUIRED_STATUS = [410, 404];

const downloadMediaMessage = async (message, type, options, ctx) => {
    const result = await downloadMsg().catch(async (error) => {
        var _a;
        if (ctx) {
            if (axios_1.default.isAxiosError(error)) {
                if (REUPLOAD_REQUIRED_STATUS.includes((_a = error.response) === null || _a === void 0 ? void 0 : _a.status)) {
                    ctx.logger.info({ key: message.key }, 'sending reupload media request...');
                    message = await ctx.reuploadRequest(message);
                    const result = await downloadMsg(); return result;
                }
            }
        }
        throw error;
    });
    return result;
    async function downloadMsg() {
        const mContent = (0, exports.extractMessageContent)(message.message);
        if (!mContent) { throw new boom_1.Boom('No message present', { statusCode: 400, data: message }); }
        const contentType = (0, exports.getContentType)(mContent);
        let mediaType = contentType === null || contentType === void 0 ? void 0 : contentType.replace('Message', '');
        const media = contentType === "productMessage" ? mContent[contentType]?.product?.productImage : mContent[contentType];
        if (!media || typeof media !== 'object' || (!('url' in media) && !('thumbnailDirectPath' in media))) {
            throw new boom_1.Boom(`"${contentType}" message is not a media message`);
        }
        let download;
        if ('thumbnailDirectPath' in media && !('url' in media)) {
            download = { directPath: media.thumbnailDirectPath, mediaKey: media.mediaKey }; mediaType = 'thumbnail-link';
        } else { download = media; }
        const stream = await (0, messages_media_1.downloadContentFromMessage)(download, mediaType, options);
        if (type === 'buffer') {
            const bufferArray = [];
            for await (const chunk of stream) { bufferArray.push(chunk); }
            return Buffer.concat(bufferArray);
        }
        return stream;
    }
};
exports.downloadMediaMessage = downloadMediaMessage;

const assertMediaContent = (content) => {
    content = (0, exports.extractMessageContent)(content);
    const mediaContent = (content === null || content === void 0 ? void 0 : content.documentMessage)
        || (content === null || content === void 0 ? void 0 : content.imageMessage)
        || (content === null || content === void 0 ? void 0 : content.videoMessage)
        || (content === null || content === void 0 ? void 0 : content.audioMessage)
        || (content === null || content === void 0 ? void 0 : content.stickerMessage);
    if (!mediaContent) { throw new boom_1.Boom('given message is not a media message', { statusCode: 400, data: content }); }
    return mediaContent;
};
exports.assertMediaContent = assertMediaContent;


```
© Credits
Modified Baileys @daffadevv
Source Bailyes @yumevtc
```

# WhatsApp Baileys

<p align="center">
  <img src="https://h.top4top.io/p_35995wdvx1.jpg" alt="Thumbnail" />
</p>

WhatsApp Baileys adalah library open‑source yang dirancang untuk membantu developer membangun solusi otomatisasi dan integrasi dengan WhatsApp secara efisien dan langsung. Menggunakan teknologi webclient.t tanpa memerlukan browser, library ini mendukung berbagai fitur seperti manajemen pesan, penanganan chat, administrasi grup, serta pesan interaktif dan tombol aksi untuk pengalaman pengguna yang lebih dinamis.

Aktif dikembangkan dan dipelihara, baileys terus menerima pembaruan untuk meningkatkan stabilitas dan performa. Salah satu fokus utamanya adalah menyempurnakan proses pairing dan autentikasi agar lebih stabil dan aman. Fitur pairing dapat dikustomisasi dengan kode buatan sendiri, membuat proses lebih andal dan tidak mudah terganggu.

Library ini sangat cocok untuk membangun bot bisnis, sistem otomatisasi chat, solusi customer service, dan berbagai aplikasi otomatisasi komunikasi lainnya yang membutuhkan stabilitas tinggi dan fitur lengkap. Dengan desain ringan dan modular, baileys mudah diintegrasikan ke berbagai sistem dan platform.

---

### Fitur Utama dan Keunggulan

- Mendukung proses pairing otomatis dan kustom
- Memperbaiki masalah pairing sebelumnya yang sering menyebabkan gagal atau disconnect
- Mendukung pesan interaktif, tombol aksi, dan menu dinamis
- Manajemen sesi otomatis yang efisien dan andal
- Kompatibel dengan fitur multi-device terbaru WhatsApp
- Ringan, stabil, dan mudah diintegrasikan ke berbagai sistem
- Cocok untuk mengembangkan bot, otomatisasi, dan solusi komunikasi lengkap
- Dokumentasi dan contoh kode yang lengkap untuk memudahkan pengembangan

---

## Memulai

Mulailah dengan menginstal library melalui package manager pilihan Anda, lalu ikuti panduan konfigurasi yang tersedia. Anda juga dapat menggunakan contoh kode yang sudah disediakan untuk memahami cara kerja fitur-fitur tersebut. Gunakan penyimpanan sesi dan fitur pesan interaktif untuk membangun solusi lengkap dan stabil sesuai kebutuhan bisnis atau proyek Anda.

---

## Dokumentasi SendMessage

### Order Message

```javascript
await client.sendMessage(groupId, {
orderMessage: {
orderId: "7778",
thumbnail: await (await fetch("URL IMG")).buffer(),
itemCount: 1000,
status: "INQUIRY",
surface: "CATALOG",
message: "dfa kimochi",
orderTitle: "kyah",
sellerJid: "0@s.whatsapp.net",
token: Buffer.from("777777"),
totalAmount1000: 1000,
currencyCode: "IDR",
messageVersion: 2
}
}, { quoted: m });
```

### Review And Pay Message 

```javascript
await client.sendMessage(m.chat, {
nativeFlowMessage: {
buttons: [
{
name: "review_and_pay",
buttonParamsJson: JSON.stringify({
currency: "IDR",
total_amount: { value: 100, offset: 100 },
reference_id: "DAFFA-DEV",
type: "daffa",
payment_status: "ganteng",
payment_timestamp: Date.now(),
order: {
status: "completed",
subtotal: { value: 100, offset: 100 },
order_type: "PAYMENT_REQUEST",
items: [
{
retailer_id: "item-" + Math.floor(Math.random() * 1e9),
name: teks,
amount: { value: 100, offset: 100 },
quantity: 1
}
]
},
additional_note: "daffa gntng bet jir",
native_payment_methods: "",
share_payment_status: true
})
}
]
}
}
}, { quoted: m })
```
### Tag Status Grup Teks

```javascript
await client.sendMessage(groupId, {
groupStatusMessage: {
text: "hello world"
}
});
```

### Tag Status Grup Gambar

```javascript
const quoted = m.quoted ? m.quoted : m;
const mime = (quoted.msg || quoted).mimetype || "";
const caption = m.body.replace(/^\.swgrup\s*/i, "").trim();
const jid = m.chat;
if (/image/.test(mime)) {
const buffer = await quoted.download();
await client.sendMessage(groupId, {
groupStatusMessage: {
image: buffer,
caption
}
});
```

### Tag Status Grup Video

```javascript
const quoted = m.quoted ? m.quoted : m;
const mime = (quoted.msg || quoted).mimetype || "";
const caption = m.body.replace(/^\.swgrup\s*/i, "").trim();
const jid = m.chat;
if (/video/.test(mime)) {
const buffer = await quoted.download();
await client.sendMessage(groupId, {
groupStatusMessage: {
video: buffer,
caption
}
});
```

### Tag Status Grup Audio

```javascript
const quoted = m.quoted ? m.quoted : m;
const mime = (quoted.msg || quoted).mimetype || "";
const caption = m.body.replace(/^\.swgrup\s*/i, "").trim();
const jid = m.chat;
if (/audio/.test(mime)) {
const buffer = await quoted.download();
await client.sendMessage(groupId, {
groupStatusMessage: {
audio: buffer,
}
});
```

### Album Message (Multiple Images)
Mengirim banyak gambar dalam satu pesan album:

```javascript
await client.sendMessage(m.chat, {
albumMessage: [
{ image: omak, caption: "Foto pertama" },
{ image: { url: "URL IMAGE" }, caption: "Foto kedua" }
]
}, { quoted: m });
```

### Event Message
Membuat dan mengirim undangan event WhatsApp:

```javascript
await client.sendMessage(m.chat, {
eventMessage: {
isCanceled: false,
name: "Hello World",
description: "ravage native",
location: {
degreesLatitude: 0,
degreesLongitude: 0,
name: "rowrrrr"
},
joinLink: "https://call.whatsapp.com/video/daffadevv",
startTime: "1763019000",
endTime: "1763026200",
extraGuestsAllowed: false
}
}, { quoted: m });
```

### Poll Result Message
Menampilkan hasil polling beserta jumlah vote:

```javascript
await client.sendMessage(m.chat, {
pollResultMessage: {
name: "Hello World",
pollVotes: [
{
optionName: "TEST 1",
optionVoteCount: "112233"
},
{
optionName: "TEST 2",
optionVoteCount: "1"
}
]
}
}, { quoted: m });
```

### Simple Interactive Message
Mengirim pesan interaktif dasar dengan tombol salin:

```javascript
await client.sendMessage(m.chat, {
interactiveMessage: {
header: "Hello World",
title: "Hello World",
footer: "telegram: @daffadevv ",
buttons: [
{
name: "cta_copy",
buttonParamsJson: JSON.stringify({
display_text: "copy code",
id: "123456789",
copy_code: "ABC123XYZ"
})
}
]
}
}, { quoted: m });
```

### Interactive Message dengan Native Flow
Mengirim pesan interaktif dengan tombol dan fitur native flow:

```javascript
await client.sendMessage(m.chat, {
interactiveMessage: {
header: "Hello World",
title: "Hello World",
footer: "telegram: @daffadevv",
image: { url: "https://example.com/image.jpg" },
nativeFlowMessage: {
messageParamsJson: JSON.stringify({
limited_time_offer: {
text: "idk hummmm?",
url: "https://t.me/daffadevv",
copy_code: "ravage",
expiration_time: Date.now() * 999
},
bottom_sheet: {
in_thread_buttons_limit: 2,
divider_indices: [1, 2, 3, 4, 5, 999],
list_title: "ravage native",
button_title: "ravage native"
},
tap_target_configuration: {
title: " X ",
description: "bomboclard",
canonical_url: "https://t.me/daffadevv",
domain: "shop.example.com",
button_index: 0
}
}),
buttons: [
{
name: "single_select",
buttonParamsJson: JSON.stringify({
has_multiple_buttons: true
})
},
{
name: "call_permission_request",
buttonParamsJson: JSON.stringify({
has_multiple_buttons: true
})
},
{
name: "single_select",
buttonParamsJson: JSON.stringify({
title: "Hello World",
sections: [
{
title: "title",
highlight_label: "label",
rows: [
{
title: "@daffadevv",
description: "love you",
id: "row_2"
}
]
}
],
has_multiple_buttons: true
})
},
{
name: "cta_copy",
buttonParamsJson: JSON.stringify({
display_text: "copy code",
id: "123456789",
copy_code: "ABC123XYZ"
})
}
]
}
}
}, { quoted: m });
```

### Interactive Message dengan Thumbnail
Mengirim pesan interaktif dengan thumbnail dan tombol salin:

```javascript
await client.sendMessage(m.chat, {
interactiveMessage: {
header: "Hello World",
title: "Hello World",
footer: "telegram: @daffadevv",
image: { url: "https://example.com/image.jpg" },
buttons: [
{
name: "cta_copy",
buttonParamsJson: JSON.stringify({
display_text: "copy code",
id: "123456789",
copy_code: "ABC123XYZ"
})
}
]
}
}, { quoted: m });
```

### Product Message
Mengirim pesan katalog produk dengan tombol dan info merchant:

```javascript
await client.sendMessage(m.chat, {
productMessage: {
title: "Produk Contoh",
description: "Ini adalah deskripsi produk",
thumbnail: { url: "https://example.com/image.jpg" },
productId: "PROD001",
retailerId: "RETAIL001",
url: "https://example.com/product",
body: "Detail produk",
footer: "Harga spesial",
priceAmount1000: 50000,
currencyCode: "USD",
buttons: [
{
name: "cta_url",
buttonParamsJson: JSON.stringify({
display_text: "Beli Sekarang",
url: "https://example.com/buy"
})
}
]
}
}, { quoted: m });
```

### Interactive Message dengan Document Buffer
Mengirim pesan interaktif dengan dokumen dari buffer (file system) — **Catatan: Dokumen hanya mendukung buffer**:

```javascript
await client.sendMessage(m.chat, {
interactiveMessage: {
header: "Hello World",
title: "Hello World",
footer: "telegram: @daffadevv",
document: fs.readFileSync("./package.json"),
mimetype: "application/pdf",
fileName: "daffadevv.pdf",
jpegThumbnail: fs.readFileSync("./document.jpeg"),
contextInfo: {
mentionedJid: [m.chat],
forwardingScore: 777,
isForwarded: false
},
externalAdReply: {
title: "Ravage",
body: "",
mediaType: 3,
thumbnailUrl: "https://example.com/image.jpg",
mediaUrl: " X ",
sourceUrl: "https://t.me/daffadevv",
showAdAttribution: true,
renderLargerThumbnail: false
},
buttons: [
{
name: "cta_url",
buttonParamsJson: JSON.stringify({
display_text: "Telegram",
url: "https://t.me/daffadevv",
merchant_url: "https://t.me/daffadevv"
})
}
]
}
}, { quoted: m });
```

### Interactive Message dengan Document Buffer (Simple)
Mengirim pesan interaktif dengan dokumen dari buffer tanpa contextInfo dan externalAdReply — **Catatan: Dokumen hanya mendukung buffer**:

```javascript
await client.sendMessage(m.chat, {
interactiveMessage: {
header: "Hello World",
title: "Hello World",
footer: "telegram: @daffadevv",
document: fs.readFileSync("./package.json"),
mimetype: "application/pdf",
fileName: "daffadevv.pdf",
jpegThumbnail: fs.readFileSync("./document.jpeg"),
buttons: [
{
name: "cta_url",
buttonParamsJson: JSON.stringify({
display_text: "Telegram",
url: "https://t.me/daffadevv",
merchant_url: "https://t.me/daffadevv"
})
}
]
}
}, { quoted: m });
```

### Request Payment Message
Mengirim pesan permintaan pembayaran dengan background dan sticker kustom:

```javascript
let quotedType = m.quoted?.mtype || '';
let quotedContent = JSON.stringify({ [quotedType]: m.quoted }, null, 2);

await client.sendMessage(m.chat, {
requestPaymentMessage: {
currency: "IDR",
amount: 10000000,
from: m.sender,
sticker: JSON.parse(quotedContent),
background: {
id: "100",
fileLength: "0",
width: 1000,
height: 1000,
mimetype: "image/webp",
placeholderArgb: 0xFF00FFFF,
textArgb: 0xFFFFFFFF,
subtextArgb: 0xFFAA00FF
}
}
}, { quoted: m });
```

---

## Mengapa Memilih WhatsApp Baileys?

Karena library ini menawarkan stabilitas tinggi, fitur lengkap, dan proses pairing yang terus ditingkatkan. Ideal bagi developer yang ingin membuat solusi otomatisasi WhatsApp yang profesional dan aman. Dukungan terhadap fitur terbaru WhatsApp memastikan kompatibilitas dengan pembaruan platform.

---

### Catatan Teknis

- Mendukung pairing code kustom yang stabil dan aman
- Memperbaiki masalah terkait pairing dan autentikasi pada versi sebelumnya
- Fitur pesan interaktif dan tombol aksi untuk membuat menu dinamis
- Manajemen sesi otomatis yang efisien untuk stabilitas jangka panjang
- Kompatibel dengan fitur multi-device terbaru WhatsApp
- Mudah diintegrasikan dan dikustomisasi sesuai kebutuhan
- Sempurna untuk mengembangkan bot, otomatisasi layanan pelanggan, dan aplikasi komunikasi lainnya

---

Untuk dokumentasi lengkap, panduan instalasi, dan contoh implementasi, silakan kunjungi repository resmi dan forum komunitas. Kami terus memperbarui dan meningkatkan library ini untuk memenuhi kebutuhan developer dan pengguna solusi otomatisasi WhatsApp modern.

**Terima kasih telah memilih WhatsApp Baileys sebagai solusi otomatisasi WhatsApp Anda!**

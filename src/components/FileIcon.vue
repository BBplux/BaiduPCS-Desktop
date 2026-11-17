<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{
  name: string;
  folder?: boolean;
  category?: number;
  size?: number;
}>();
const artwork = import.meta.glob<string>(
  "../assets/official/file-types/*.svg",
  { eager: true, query: "?url", import: "default" },
);
const extensions: Record<string, string> = {};
for (const [type, names] of Object.entries({
  zip: "zip rar 7z tar gz bz2 xz tgz zst",
  image: "jpg jpeg png gif webp bmp svg heic heif tif tiff ico avif",
  video: "mp4 mkv avi mov wmv flv webm rm rmvb m4v mpg mpeg ts",
  audio: "mp3 flac wav aac ogg m4a wma ape opus",
  doc: "doc docx rtf odt",
  excel: "xls xlsx csv ods",
  ppt: "ppt pptx odp",
  txt: "txt md log",
  code: "c cpp h hpp py rs go java sh json xml yaml yml ts tsx jsx vue sql",
  font: "ttf otf woff woff2",
  cad: "dwg dxf",
  web: "html htm",
  pdf: "pdf",
  ai: "ai",
  psd: "psd",
  apk: "apk",
  exe: "exe msi",
  dmg: "dmg",
  epub: "epub mobi azw azw3",
  torrent: "torrent",
  css: "css scss less",
  js: "js mjs cjs",
  chm: "chm",
  flash: "swf",
  key: "key",
  link: "url lnk",
  mm: "mm",
  mmap: "mmap",
  numbers: "numbers",
  pages: "pages",
  sketch: "sketch",
  vcard: "vcf vcard",
  vsd: "vsd vsdx",
  xmind: "xmind",
}))
  for (const extension of names.split(" ")) extensions[extension] = type;
const categories: Record<number, string> = {
  1: "video",
  2: "audio",
  3: "image",
};
const kind = computed(() => {
  if (props.folder) return "folder-y";
  const extension = props.name.includes(".")
    ? props.name.split(".").pop()!.toLowerCase()
    : "";
  return extensions[extension] || categories[props.category || 0] || "other";
});
const source = computed(
  () => artwork[`../assets/official/file-types/ic_${kind.value}.svg`],
);
</script>
<template>
  <span
    class="file-artwork"
    :style="{ width: `${size || 32}px`, height: `${size || 32}px` }"
  >
    <img
      :src="source"
      :data-file-type="kind"
      alt=""
      aria-hidden="true"
      draggable="false"
    />
  </span>
</template>

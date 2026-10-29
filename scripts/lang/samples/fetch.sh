#!/bin/sh
# Download helpers (curl, because the system Python has no CA bundle). Always sends the sample-fetcher User-Agent.
#   fetch.sh gutenberg <ebook-id> <out.txt>          -> the UTF-8 plain text of a Project Gutenberg ebook
#   fetch.sh wikisource <lang> <Page_title> <out.html> -> the rendered page body (action=render)
UA="Dushu-sample-fetcher/0.1 (personal reading app)"
case "$1" in
  gutenberg)
    for u in "https://www.gutenberg.org/cache/epub/$2/pg$2.txt" "https://www.gutenberg.org/ebooks/$2.txt.utf-8" "https://www.gutenberg.org/files/$2/$2-0.txt"; do
      curl -sfL -m 120 -A "$UA" "$u" -o "$3" && [ -s "$3" ] && exit 0
    done; echo "gutenberg $2 failed" >&2; exit 1 ;;
  wikisource)
    T=$(python3 -I -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1].replace(" ","_"),safe="()_,!"))' "$3")
    curl -sfL -m 120 -A "$UA" "https://$2.wikisource.org/w/index.php?title=$T&action=render" -o "$4" ;;
  wsopen)
    Q=$(python3 -I -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$3")
    curl -sfL -m 60 -A "$UA" "https://$2.wikisource.org/w/api.php?action=opensearch&limit=15&search=$Q&format=json" | python3 -I -c 'import sys,json;[print(x) for x in json.load(sys.stdin)[1]]' ;;
  wssearch)
    Q=$(python3 -I -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$3")
    curl -sfL -m 60 -A "$UA" "https://$2.wikisource.org/w/index.php?search=$Q&ns0=1&fulltext=1&limit=15" | python3 -I -c 'import sys,re,urllib.parse;[print(urllib.parse.unquote(x)) for x in dict.fromkeys(re.findall(r"href=\"/wiki/([^\"#]+)\"",sys.stdin.read())) if ":" not in x]' ;;
esac
# (see wsopen)
# fetch.sh wsopen <lang> <prefix>  -> up to 15 page titles starting with prefix (opensearch)

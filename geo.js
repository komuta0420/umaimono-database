// geo.js - 駅距離計算・Geocoding

const GEO = (() => {
  // stations.json を読み込んだデータを保持
  let stationsData = null;

  // ────────────────────────────────────────
  // stations.json の読み込み（初回のみ）
  // ────────────────────────────────────────
  async function loadStations() {
    if (stationsData) return stationsData;
    try {
      const res = await fetch('./stations.json');
      stationsData = await res.json();
      return stationsData;
    } catch (e) {
      console.error('stations.json の読み込みに失敗しました:', e);
      stationsData = {};
      return stationsData;
    }
  }

  // ────────────────────────────────────────
  // Haversine formula: 2点間の距離（km）
  // ────────────────────────────────────────
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371; // 地球の半径 (km)
    const toRad = (deg) => deg * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ────────────────────────────────────────
  // 徒歩15分以内（半径1.2km）判定
  // ────────────────────────────────────────
  async function isWithin15min(storeLat, storeLng, stationName) {
    const stations = await loadStations();
    const station = findStation(stations, stationName);
    if (!station) return false;

    const dist = haversine(storeLat, storeLng, station.lat, station.lng);
    return dist <= 1.2;
  }

  // ────────────────────────────────────────
  // 駅名のあいまいマッチ（「渋谷」で「渋谷駅」もヒット）
  // ────────────────────────────────────────
  function findStation(stations, name) {
    if (!name) return null;
    const normalized = name.replace(/駅$/, '').trim();

    // 完全一致を優先
    if (stations[normalized]) return stations[normalized];

    // 前方一致
    const forwardMatch = Object.keys(stations).find((key) =>
      key.startsWith(normalized) || normalized.startsWith(key)
    );
    if (forwardMatch) return stations[forwardMatch];

    // 部分一致
    const partialMatch = Object.keys(stations).find((key) =>
      key.includes(normalized) || normalized.includes(key)
    );
    if (partialMatch) return stations[partialMatch];

    return null;
  }

  // ────────────────────────────────────────
  // 駅名検索（候補リスト返却）
  // ────────────────────────────────────────
  async function searchStations(query) {
    const stations = await loadStations();
    if (!query || query.length < 1) return [];

    const normalized = query.replace(/駅$/, '').trim();
    return Object.keys(stations)
      .filter((name) => name.includes(normalized))
      .slice(0, 10); // 最大10件
  }

  // ────────────────────────────────────────
  // 店舗と駅の距離を計算（km）
  // ────────────────────────────────────────
  async function distanceTo(storeLat, storeLng, stationName) {
    const stations = await loadStations();
    const station = findStation(stations, stationName);
    if (!station) return null;
    return haversine(storeLat, storeLng, station.lat, station.lng);
  }

  // ────────────────────────────────────────
  // 近隣駅を探す（半径 radiusKm 以内の駅名リスト）
  // ────────────────────────────────────────
  async function findNearbyStations(lat, lng, radiusKm = 1.2) {
    const stations = await loadStations();
    return Object.entries(stations)
      .filter(([, pos]) => haversine(lat, lng, pos.lat, pos.lng) <= radiusKm)
      .map(([name, pos]) => ({
        name,
        distance: Math.round(haversine(lat, lng, pos.lat, pos.lng) * 1000), // メートル
      }))
      .sort((a, b) => a.distance - b.distance);
  }

  // ────────────────────────────────────────
  // Nominatim (OpenStreetMap): 住所 → 緯度経度
  // APIキー不要・無料（利用制限: 1リクエスト/秒）
  // ────────────────────────────────────────
  async function geocodeAddress(address) {
    // 郵便番号・ビル名・階数を除去
    const clean = address
      .replace(/〒\d{3}-?\d{4}\s*/g, '')
      .replace(/\s+[\u3040-\u30FF\u4E00-\u9FFF]+ビル\S*/g, '') // ○○ビル以降
      .replace(/\s+\S*[棟号室階]\S*/g, '')                      // 棟・号室・階
      .trim();

    // Nominatim に試すクエリを順に用意（詳細 → 段階的に簡略化）
    // Nominatim の日本住所カバレッジは丁目レベルが上限のため、早めに絞る
    const base = clean || address;
    const queries = [
      // 丁目形式に変換: 3-14-13 → 3丁目、3丁目14番13号 → 3丁目
      base.replace(/(\d+)丁目.*$/, '$1丁目').replace(/(\d+)-\d+.*$/, '$1丁目'),
      base.replace(/-\d+(-\d+)?$/, ''),  // ハイフン末尾除去
      base,                               // 元の住所
    ].filter((q, i, arr) => q && arr.indexOf(q) === i);

    const tryGeocode = async (q) => {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=ja`;
      const res = await fetch(url, { headers: { 'User-Agent': 'food-shop-database/1.0' } });
      const data = await res.json();
      return data?.length ? data[0] : null;
    };

    let found = null;
    for (const q of queries) {
      found = await tryGeocode(q);
      if (found) break;
    }

    if (!found) {
      throw new Error(`住所の変換に失敗しました: ${address}`);
    }
    const data = [found];

    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      formattedAddress: data[0].display_name,
    };
  }

  return {
    loadStations,
    haversine,
    isWithin15min,
    findStation,
    searchStations,
    distanceTo,
    findNearbyStations,
    geocodeAddress,
  };
})();

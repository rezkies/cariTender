// scraper.js
import { JSDOM } from 'jsdom';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Set __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========== UTILS ==========
function extractAuthToken(text) {
  const regex = /d\.authenticityToken\s*=\s*['"]([^'"]+)['"]/;
  const match = text.match(regex);
  return match ? match[1] : null;
}

function parseHTML(text) {
  return new JSDOM(text).window.document;
}

function getValueByHeader(doc, headerText) {
  const rows = doc?.querySelectorAll?.('table.table.table-sm.table-bordered tr') || [];
  for (const row of rows) {
    const th = row.querySelector('th');
    if (th && th.textContent.trim() === headerText) {
      return row.querySelector('td')?.textContent.trim() ?? null;
    }
  }
  return null;
}

function getLokasiPekerjaan(doc) {
  const rows = doc?.querySelectorAll?.('table.table.table-sm.table-bordered tr') || [];
  for (const row of rows) {
    const th = row.querySelector('th');
    if (th && th.textContent.trim() === "Lokasi Pekerjaan") {
      return Array.from(row.querySelectorAll('li')).map(li => li.textContent.trim());
    }
  }
  return [];
}

function saveJSON(filename, data) {
  const filePath = path.resolve(__dirname, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`✅ Saved: ${filePath}`);
}

async function getAuthTokenFromUrl(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);

    const text = await response.text();
    const token = extractAuthToken(text);
    const cookieHeader = response.headers.get('set-cookie');
    const cookies = cookieHeader ? cookieHeader.split(',').map(c => c.split(';')[0]).join('; ') : '';

    return { token, cookies };
  } catch (err) {
    console.error('Token fetch error:', err.message);
    return { token: null, cookies: null };
  }
}

// ========== CORE SCRAPER ==========

async function getInformation(idData, mode, referer) {
	const MAX_ATTEMPTS = 3;
	const RETRY_DELAY_MS = 1000; // optional delay between retries

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const url = mode === 'tender'
				? `https://spse.inaproc.id/jabarprov/lelang/${idData}/pengumumanlelang`
				: mode === 'non-tender'
					? `https://spse.inaproc.id/jabarprov/nontender/${idData}/pengumumanpl`
					: `https://spse.inaproc.id/jabarprov/pencatatan/pengumumannonspk?id=${idData}`;

			const res = await fetch(url, {
				method: "GET",
				headers: {
					"accept": "application/json, text/javascript, */*; q=0.01",
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
					"x-requested-with": "XMLHttpRequest",
					"user-agent": "Mozilla/5.0",
					"referer": referer
				}
			});

			if (!res.ok) throw new Error(`HTTP error ${res.status}`);

			const html = await res.text();
			const doc = parseHTML(html);

			if (mode === 'tender') {
				return {
					id: idData,
					tipePengadaan: mode,
					kodeTender: getValueByHeader(doc, "Kode Tender"),
					tahunAnggaran: getValueByHeader(doc, "Tahun Anggaran"),
					metodePengadaan: getValueByHeader(doc, "Metode Pengadaan"),
					jenisKontrak: getValueByHeader(doc, "Jenis Kontrak"),
					lokasiPekerjaan: getLokasiPekerjaan(doc)
				};
			} else if (mode === 'non-tender') {
				return {
					id: idData,
					tipePengadaan: mode,
					kodeTender: getValueByHeader(doc, "Kode Paket"),
					tahunAnggaran: getValueByHeader(doc, "Tahun Anggaran"),
					metodePengadaan: getValueByHeader(doc, "Metode Pengadaan"),
					jenisKontrak: getValueByHeader(doc, "Jenis Kontrak"),
					lokasiPekerjaan: getLokasiPekerjaan(doc)
				};
			} else {
				return {
					id: idData,
					tipePengadaan: mode,
					kodeTender: getValueByHeader(doc, "Kode Paket"),
					tahunAnggaran: getValueByHeader(doc, "Tahun Anggaran"),
					metodePengadaan: getValueByHeader(doc, "Metode Pengadaan"),
					jenisPengadaan: getValueByHeader(doc, "Jenis Pengadaan")
				};
			}
		} catch (err) {
			console.warn(`⚠️ Attempt ${attempt} failed for ID ${idData}: ${err.message}`);
			if (attempt < MAX_ATTEMPTS) {
				await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
			} else {
				console.error(`❌ All ${MAX_ATTEMPTS} attempts failed for ID ${idData}`);
				return {};
			}
		}
	}
}

async function getPemenang(idData, mode) {
	let urls;
	const referer = mode === 'tender'
		? `https://spse.inaproc.id/jabarprov/lelang/${idData}/pengumumanlelang`
		: mode === 'non-tender'
			? `https://spse.inaproc.id/jabarprov/nontender/${idData}/pengumumanpl`
			: `https://spse.inaproc.id/jabarprov/pencatatan/pengumumannonspk?id=${idData}`;

	if (mode === 'tender') {
		urls = [
			`https://spse.inaproc.id/jabarprov/evaluasi/${idData}/pemenangberkontrak`,
			`https://spse.inaproc.id/jabarprov/evaluasi/${idData}/pemenang`,
			`https://spse.inaproc.id/jabarprov/evaluasitender/${idData}/pemenang`,
		];
	} else if (mode === 'non-tender') {
		urls = [
			`https://spse.inaproc.id/jabarprov/evaluasinontender/${idData}/pemenang`,
		];
	} else {
		urls = [
			`https://spse.inaproc.id/jabarprov/pencatatan/pengumumannonspkpemenang?id=${idData}`
		];
	}

	for (const url of urls) {
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const res = await fetch(url, {
					method: "GET",
					headers: {
						"accept": "application/json, text/javascript, */*; q=0.01",
						"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
						"x-requested-with": "XMLHttpRequest",
						"user-agent": "Mozilla/5.0",
						"referer": referer
					}
				});

				if (!res.ok) throw new Error(`HTTP error: ${res.status}`);

				const html = await res.text();
				const doc = parseHTML(html);
				const cells = doc.querySelectorAll('td');

				if (cells.length < 13) break; // Skip to next URL

				if (mode !== 'pencatatan') {
					// ✅ Return success
					return {
						id: idData,
						namaTender: cells[0]?.textContent.trim(),
						jenisPengadaan: cells[1]?.textContent.trim(),
						instansi: cells[2]?.textContent.trim(),
						satuan: cells[3]?.textContent.trim(),
						pagu: cells[4]?.textContent.trim(),
						hps: cells[5]?.textContent.trim(),
						namaPemenang: cells[7]?.textContent.trim(),
						alamat: cells[8]?.textContent.trim(),
						npwp: cells[9]?.textContent.trim(),
						hargaPenawaran: cells[10]?.textContent.trim(),
						hargaTerkoreksi: cells[11]?.textContent.trim(),
						hargaNegosiasi: cells[12]?.textContent.trim()
					};
				} else {
					const tables = doc.querySelectorAll("table");
					const secondTable = tables[1];
					const result = [];

					for (let i = 1; i < secondTable.rows.length; i++) {
						const row = secondTable.rows[i];
						if (row.closest("table") !== secondTable) continue;

						const cells2 = row.cells;
						if (cells2.length >= 4) {
							const jenisRealisasi = cells2[1]?.textContent.trim();
							const nilaiRealisasi = cells2[2]?.textContent.trim();
							const tanggalRealisasi = cells2[3]?.textContent.trim();

							const nextRow = secondTable.rows[i + 1];
							let penyedia = {};
							if (nextRow && nextRow.querySelector("table")) {
								const nestedTable = nextRow.querySelector("table");
								const penyediaRow = Array.from(nestedTable.querySelectorAll("tr"))
									.find(tr => tr.querySelector("td"));

								const penyediaCells = penyediaRow ? penyediaRow.cells : [];

								penyedia = {
									id: idData,
									namaPenyedia: penyediaCells[1]?.textContent.trim() || '',
									npwp: penyediaCells[2]?.textContent.trim() || '',
									email: penyediaCells[3]?.textContent.trim() || '',
									telp: penyediaCells[4]?.textContent.trim() || '',
									alamat: penyediaCells[5]?.textContent.trim() || '',
								};

								i++; // Skip nested row
							}

							result.push({
								jenisRealisasi,
								nilaiRealisasi,
								tanggalRealisasi,
								...penyedia
							});
						}
					}

					// ✅ Return success
					return {
						id: idData,
						namaTender: cells[0]?.textContent.trim(),
						jenisPengadaan: cells[1]?.textContent.trim(),
						instansi: cells[2]?.textContent.trim(),
						satuan: cells[3]?.textContent.trim(),
						pagu: cells[4]?.textContent.trim(),
						hps: cells[5]?.textContent.trim(),
						namaPemenang: result
					};
				}
			} catch (err) {
				console.warn(`Attempt ${attempt + 1} failed for URL: ${url}`);
				if (attempt === 2) {
					console.error(`❌ Failed after 3 attempts for URL: ${url}`);
				}
			}
		}
	}

	console.error(`❌ No pemenang found for ID ${idData}`);
	return {};
}


// ========== RUNNER FUNCTION ==========
export async function run(companyName, save = false) {
  if (!companyName) {
    throw new Error('Missing companyName parameter');
  }

  const encodedCompanyName = encodeURIComponent(companyName);
  const pages = [
    {
      mode: 'tender',
      tokenSourceUrl: 'https://spse.inaproc.id/jabarprov/lelang',
      listUrl: `https://spse.inaproc.id/jabarprov/dt/lelang?rekanan=${encodedCompanyName}`
    },
    {
      mode: 'non-tender',
      tokenSourceUrl: 'https://spse.inaproc.id/jabarprov/nontender',
      listUrl: `https://spse.inaproc.id/jabarprov/dt/pl?rekanan=${encodedCompanyName}`
    },
    {
      mode: 'pencatatan',
      tokenSourceUrl: 'https://spse.inaproc.id/jabarprov/pencatatan',
      listUrl: `https://spse.inaproc.id/jabarprov/dt/nonspk?rekanan=${encodedCompanyName}`
    }
  ];

  const mergedResults = [];

  for (const page of pages) {
    console.log(`🔍 Scraping ${page.mode} for "${companyName}"`);
    const { token, cookies } = await getAuthTokenFromUrl(page.tokenSourceUrl);
    if (!token || !cookies) {
      console.error(`❌ Failed to get token for ${page.mode}`);
      continue;
    }

    try {
      const res = await fetch(page.listUrl, {
        method: "POST",
        headers: {
          "accept": "application/json, text/javascript, */*; q=0.01",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
          "user-agent": "Mozilla/5.0",
          "referer": page.tokenSourceUrl,
          "cookie": cookies
        },
        body: `draw=1&start=0&length=1000&search%5Bvalue%5D=&search%5Bregex%5D=false&authenticityToken=${token}`
      });

      const jsonData = await res.json();
      const entries = jsonData?.data || [];

      const finishedStatus = page.mode === 'tender' ? "Tender Sudah Selesai" : "Paket Sudah Selesai";

      const finished = page.mode !== 'pencatatan'
        ? entries.filter(row => row[3] === finishedStatus).map(row => ({ id: row[0], status: row[3] }))
        : entries.filter(row => row[8] === finishedStatus).map(row => ({ id: row[0], status: row[8] }));

      console.log(`📄 Found ${finished.length} finished entries for ${page.mode}`);

      for (const entry of finished) {
        console.log(`⏳ Processing ID: ${entry.id}`);
        const info = await getInformation(entry.id, page.mode, page.listUrl);
        const pemenang = await getPemenang(entry.id, page.mode);
        mergedResults.push({ ...info, ...pemenang });
      }

    } catch (err) {
      console.error(`❌ Error fetching list for ${page.mode}:`, err.message);
    }
  }

  if (save) {
    saveJSON(`${companyName.replace(/\s+/g, ' ')}.json`, mergedResults);
  }

  return mergedResults;
}


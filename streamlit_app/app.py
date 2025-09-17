import streamlit as st
import pandas as pd
import requests
import altair as alt

st.title("Ringkasan Data Inaproc Jabar")

# -------------------------------
# 🔄 Caching: API Call + Processing
# -------------------------------

@st.cache_data(show_spinner="Mengunduh dan memproses data...")
def fetch_and_process(companyName: str):
    # Fetch from API
    res = requests.post("https://caritender.onrender.com/scrape", json={"companyName": companyName})
    res.raise_for_status()
    data = res.json()

    if not isinstance(data, list) or len(data) == 0:
        return None, None, None

    df = pd.json_normalize(data)

    # Clean and filter
    df['tahunAnggaran'] = df['tahunAnggaran'].str.extract(r'(\d{4})')
    df['tahunAnggaran'] = pd.to_numeric(df['tahunAnggaran'], errors='coerce').dropna().astype(int)
    df = df[df.tahunAnggaran >= 2020]

    def clean_currency(currency_str):
        if isinstance(currency_str, str):
            cleaned_str = currency_str.replace('Rp. ','').replace('.', '').replace(',', '.')
            try:
                return float(cleaned_str)
            except ValueError:
                return 0.0
        return 0.0

    tender_df = df[df['tipePengadaan']=='tender'].copy()
    if not tender_df.empty:
        tender_df['hargaNegosiasi'] = tender_df['hargaNegosiasi'].apply(clean_currency)
    nonTender_df = df[df['tipePengadaan']=='non-tender'].copy()
    if not nonTender_df.empty:
        nonTender_df['hargaNegosiasi'] = nonTender_df['hargaNegosiasi'].apply(clean_currency)
    pencatatan_df = df[df['tipePengadaan']=='pencatatan'].copy()
    if not pencatatan_df.empty:
        pencatatan_df = pencatatan_df.drop(columns=['namaPemenang'])\
                        .merge(pd.json_normalize(pencatatan_df['namaPemenang'].explode()), on='id')
        pencatatan_df = pencatatan_df[pencatatan_df['namaPenyedia'].str.contains(companyName, case=False, na=False)]
        pencatatan_df['nilaiRealisasi'] = pencatatan_df['nilaiRealisasi'].apply(clean_currency)

    return tender_df, nonTender_df, pencatatan_df

# -------------------------------
# 🧾 UI: Company Name Input
# -------------------------------

company = st.text_input("Masukan nama perusahaan")

if company:
    try:
        tender_df, nonTender_df, pencatatan_df = fetch_and_process(company)

        # If all are None or empty, warn user
        if (tender_df is None or tender_df.empty) and (nonTender_df is None or nonTender_df.empty) and (pencatatan_df is None or pencatatan_df.empty):
            st.warning("⚠️ Tidak ada data yang ditemukan di semua kategori.")
        else:
            st.success("✅ Data diunduh dan diproses.")

            with st.expander("🔍 Lihat Data Mentah"):
                if tender_df is not None and not tender_df.empty:
                    st.write("Tender", tender_df)
                else:
                    st.info("Data tender tidak tersedia.")

                if nonTender_df is not None and not nonTender_df.empty:
                    st.write("Non-Tender", nonTender_df)
                else:
                    st.info("Data Non-Tender tidak tersedia.")

                if pencatatan_df is not None and not pencatatan_df.empty:
                    st.write("Pencatatan", pencatatan_df)
                else:
                    st.info("Data pencatatan tidak tersedia.")

            # Prepare entry counts dataframe dynamically
            counts = {}
            if tender_df is not None and not tender_df.empty:
                counts['Tender'] = tender_df['tahunAnggaran'].value_counts().sort_index()
            if nonTender_df is not None and not nonTender_df.empty:
                counts['Non-Tender'] = nonTender_df['tahunAnggaran'].value_counts().sort_index()
            if pencatatan_df is not None and not pencatatan_df.empty:
                counts['Pencatatan'] = pencatatan_df['tahunAnggaran'].value_counts().sort_index()

            if counts:
                all_counts = pd.DataFrame(counts).fillna(0).astype(int)
                count_df = all_counts.reset_index().melt(id_vars='tahunAnggaran', var_name='Category', value_name='Count')
                count_df.rename(columns={'tahunAnggaran': 'Year'}, inplace=True)

                st.subheader("🧮 Jumlah Pengadaan per Tahun")
                chart = alt.Chart(count_df).mark_bar().encode(
                    x=alt.X('Year:O'),
                    y=alt.Y('Count:Q'),
                    color='Category:N',
                    tooltip=['Year', 'Category', 'Count']
                ).properties(width=700, height=400)
                st.altair_chart(chart, use_container_width=True)
            else:
                st.info("No data available to plot Entry Counts.")

            # Prepare total value dataframe dynamically
            values = {}
            if tender_df is not None and not tender_df.empty:
                values['Tender'] = tender_df.groupby('tahunAnggaran')['hargaNegosiasi'].sum()
            if nonTender_df is not None and not nonTender_df.empty:
                values['Non-Tender'] = nonTender_df.groupby('tahunAnggaran')['hargaNegosiasi'].sum()
            if pencatatan_df is not None and not pencatatan_df.empty:
                values['Pencatatan'] = pencatatan_df.groupby('tahunAnggaran')['nilaiRealisasi'].sum()

            if values:
                all_values = pd.DataFrame(values).fillna(0)
                value_df = all_values.reset_index().melt(id_vars='tahunAnggaran', var_name='Category', value_name='Value')
                value_df.rename(columns={'tahunAnggaran': 'Year'}, inplace=True)

                st.subheader("💵 Total Pendapatan per Tahun berdasarkan Kategori Kegiatan")
                chart2 = alt.Chart(value_df).mark_bar().encode(
                    x=alt.X('Year:O'),
                    y=alt.Y('Value:Q', title="Total Value (Rp.)"),
                    color='Category:N',
                    tooltip=['Year', 'Category', alt.Tooltip('Value:Q', format=',')]
                ).properties(width=700, height=400)
                st.altair_chart(chart2, use_container_width=True)
            else:
                st.info("No data available to plot Total Values.")

            # ============================
            # 📊 Additional Charts by jenisPengadaan
            # ============================

            st.subheader("📘 Ringkasan berdasarkan Jenis Pengadaan")

            combined_df = pd.DataFrame()
            if tender_df is not None and not tender_df.empty:
                tender_df['kategori'] = 'Tender'
                tender_df = tender_df.rename(columns={'hargaNegosiasi': 'nilai'})
                combined_df = pd.concat([combined_df, tender_df[['tahunAnggaran', 'jenisPengadaan', 'nilai']]])

            if nonTender_df is not None and not nonTender_df.empty:
                nonTender_df['kategori'] = 'Non-Tender'
                nonTender_df = nonTender_df.rename(columns={'hargaNegosiasi': 'nilai'})
                combined_df = pd.concat([combined_df, nonTender_df[['tahunAnggaran', 'jenisPengadaan', 'nilai']]])

            if pencatatan_df is not None and not pencatatan_df.empty:
                pencatatan_df['kategori'] = 'Pencatatan'
                pencatatan_df = pencatatan_df.rename(columns={'nilaiRealisasi': 'nilai'})
                combined_df = pd.concat([combined_df, pencatatan_df[['tahunAnggaran', 'jenisPengadaan', 'nilai']]])

            if not combined_df.empty:
                # 📈 Count by tahunAnggaran and jenisPengadaan
                jenis_count_df = (
                    combined_df.groupby(['tahunAnggaran', 'jenisPengadaan'])
                    .size()
                    .reset_index(name='Count')
                    .rename(columns={'tahunAnggaran': 'Year'})
                )

                st.subheader("📌 Jumlah Pengadaan per Tahun berdasarkan Jenis Pengadaan")
                chart3 = alt.Chart(jenis_count_df).mark_bar().encode(
                    x=alt.X('Year:O'),
                    y=alt.Y('Count:Q'),
                    color='jenisPengadaan:N',
                    tooltip=['Year', 'jenisPengadaan', 'Count']
                ).properties(width=700, height=400)
                st.altair_chart(chart3, use_container_width=True)

                # 💰 Value by tahunAnggaran and jenisPengadaan
                jenis_value_df = (
                    combined_df.groupby(['tahunAnggaran', 'jenisPengadaan'])['nilai']
                    .sum()
                    .reset_index(name='Value')
                    .rename(columns={'tahunAnggaran': 'Year'})
                )

                st.subheader("💰 Total Nilai Pengadaan per Tahun berdasarkan Jenis Pengadaan")
                chart4 = alt.Chart(jenis_value_df).mark_bar().encode(
                    x=alt.X('Year:O'),
                    y=alt.Y('Value:Q', title='Total Value (Rp.)'),
                    color='jenisPengadaan:N',
                    tooltip=['Year', 'jenisPengadaan', alt.Tooltip('Value:Q', format=',')]
                ).properties(width=700, height=400)
                st.altair_chart(chart4, use_container_width=True)
            else:
                st.info("Tidak ada data yang bisa diproses untuk chart berdasarkan Jenis Pengadaan.")

    except Exception as e:
        st.error(f"❌ Error: {e}")
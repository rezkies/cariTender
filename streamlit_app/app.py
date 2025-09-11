import streamlit as st
import requests
import pandas as pd

st.title("📊 Tender Data Viewer")

company = st.text_input("Enter Company Name")

if company:
    with st.spinner("Fetching data from Node.js API..."):
        try:
            res = requests.post(
                "https://node-api-xxxxx.onrender.com/scrape",  # Replace with your real URL
                json={"companyName": company}
            )
            res.raise_for_status()
            data = res.json()
            
            if isinstance(data, list) and data:
                df = pd.DataFrame(data)
                st.success(f"✅ Found {len(df)} entries.")
                st.dataframe(df)
            else:
                st.warning("⚠️ No results found.")
        except Exception as e:
            st.error(f"❌ Error: {e}")

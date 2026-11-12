import pandas as pd
from sqlalchemy import create_engine

# 1. Read the CSV file using Pandas (handles all column mapping automatically)
print("Reading CSV file...")
df = pd.read_csv("C:/Users/naray/Downloads/Tableau Full Project.csv", low_memory=False)

# 2. Clean up column names to match standard SQL conventions
df.columns = df.columns.str.strip().str.lower().str.replace(' ', '_')

# 3. Connect to your PostgreSQL database
print("Connecting to PostgreSQL...")
engine = create_engine("postgresql://postgres:ascend101@localhost:5432/airbnb_db")

# 4. Ingest data directly into the database table
print("Importing data into 'listing_seattle' table...")
df.to_sql("listing_seattle", engine, if_exists="replace", index=False)

print("✅ Success! All data has been loaded into PostgreSQL.")
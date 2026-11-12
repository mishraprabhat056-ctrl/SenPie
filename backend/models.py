from sqlalchemy import Column, Integer, String, Float, Date
from database import Base

class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    region = Column(String, index=True)
    product = Column(String, index=True)
    revenue = Column(Float)
    order_date = Column(Date)
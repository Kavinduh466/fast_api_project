# models/order.py

from sqlalchemy import Column, Integer, String, Float, DateTime, Enum, ForeignKey
from sqlalchemy.orm import relationship, declarative_base
from datetime import datetime,timezone
import enum
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
from .base import Base



class BookTypeEnum(str,enum.Enum):
    Novel = "NOVEL"
    Science = "SCIENCE"
    Fairytale = "FAIRYTALE"

class Book(Base):
     __tablename__ = "books"

     book_id = Column(Integer, primary_key=True, index=True)
     bookType = Column(Enum(BookTypeEnum), default=BookTypeEnum.Science)
     booktitle = Column(String, nullable=False)
     pages = Column(String, nullable=False)

     author_id = Column(Integer, ForeignKey("authors.author_id"))

     authors = relationship("Author", back_populates="books")



class Author(Base):
     __tablename__= "authors"

     author_id = Column(Integer,primary_key=True, index=True)
     name  =  Column(String, nullable=False)
     email =  Column(String, nullable=False)

     book = relationship("Book", back_populates="authors")



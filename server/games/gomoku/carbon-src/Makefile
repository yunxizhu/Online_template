# Build Carbon AI (pbrain) for Windows with MinGW g++
# Usage: from this directory, run: mingw32-make
# Output: ../engines/carbon/pbrain-carbon.exe

CXX ?= g++
CXXFLAGS = -O2 -std=c++11 -DNDEBUG -Wno-write-strings -Wno-unused-variable -Wno-unused-but-set-variable
LDFLAGS = -static -lwinmm

SRCS = AICarbon.cpp AICarbonMove.cpp AIwrapper.cpp Random.cpp pisqpipe.cpp
OBJS = $(SRCS:.cpp=.o)
OUTDIR = ../engines/carbon
TARGET = $(OUTDIR)/pbrain-carbon.exe

.PHONY: all clean

all: $(TARGET)

$(OUTDIR):
	mkdir -p $(OUTDIR)

$(TARGET): $(OBJS) | $(OUTDIR)
	$(CXX) -o $@ $(OBJS) $(LDFLAGS)

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

clean:
	rm -f $(OBJS) $(TARGET)

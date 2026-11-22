import sys
from pathlib import Path

# Let `pytest` run from the repo root as well as from engine/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

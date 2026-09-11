"""Show which items would be regenerated if the run command were called now."""
import sys, os
sys.path.insert(0, '/app/tools')
os.environ.setdefault('PYTHONPATH', '/app/tools')

from content_gen.cli import main
sys.exit(main(['--scope', 'tier0', 'diff']))

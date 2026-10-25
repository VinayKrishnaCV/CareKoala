"""Assemble the self-contained runtime that the Windows installer ships.

Run with the project virtual environment (same CPython 3.12 as the bundle):
    .venv\\Scripts\\python.exe scripts\\stage_desktop_bundle.py

Output: electron-app/staging/engine/ (packaged as resources/engine). Only
runtime pieces are copied: training packages, datasets, adapters other than
v2, caches and developer paths stay out of the installer.
"""
from __future__ import annotations

import compileall
import importlib.metadata as metadata
import os
import re
import shutil
import sys
from pathlib import Path

from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

PROJECT = Path(__file__).resolve().parents[1]
APP = PROJECT / 'electron-app'
STAGING = APP / 'staging'
ENGINE = STAGING / 'engine'
DOWNLOADS = STAGING / 'downloads'
MODEL_ROOT = Path(os.getenv('CAREKOALA_MODEL_ROOT', PROJECT.parent / 'NewModel' / 'CareKoala'))
LLAMA = PROJECT / 'runtime' / 'llama-b11036'
LLAMA_LICENSE = MODEL_ROOT / 'engine' / 'bin' / 'linux-x64' / 'llama-b11036' / 'LICENSE'
OCR_WEIGHTS = Path.home() / '.EasyOCR' / 'model'

# Imported at runtime by the backend, workers and OCR. Resolved transitively.
RUNTIME_REQUIREMENTS = ['fastapi', 'uvicorn', 'pydantic', 'cryptography', 'easyocr',
                        'opencv-python-headless', 'Pillow', 'numpy']
BACKEND_MODULES = ['__init__', 'api', 'guardian', 'schemas', 'guardian_protocol', 'guardian_worker',
                   'lockdown_worker', 'inference_worker', 'trained_model', 'trained_prompt']
# Package test folders stay: numpy.testing imports numpy._core.tests at run time.
# torch's C++ headers, CMake files and .lib import libraries only serve compiling
# extensions. Dropping them removes a third of all files (install time) and every
# path long enough to approach the Windows 260-character limit.
def build_only(parts):
    return parts[:2] in (('torch', 'include'), ('torch', 'share')) or (parts[:2] == ('torch', 'lib') and parts[-1].endswith('.lib'))


STDLIB_SKIP = {'site-packages', 'test', 'idlelib', 'tkinter', 'turtledemo', 'ensurepip', '__pycache__'}


def closure(names):
    env = default_environment() | {'extra': ''}
    seen, queue = {}, list(names)
    while queue:
        name = canonicalize_name(queue.pop())
        if name in seen:
            continue
        dist = metadata.distribution(name)
        seen[name] = dist
        for spec in dist.requires or []:
            requirement = Requirement(spec)
            if requirement.marker is None or requirement.marker.evaluate(env):
                queue.append(requirement.name)
    return seen


def copy_file(source: Path, target: Path, link=False):
    target.parent.mkdir(parents=True, exist_ok=True)
    if link:
        try:
            os.link(source, target)  # Same drive: large weights are not duplicated.
            return
        except OSError:
            pass
    shutil.copy2(source, target)


def stage_python(site_packages: Path):
    base = Path(sys.base_prefix)
    target = ENGINE / 'python'
    for name in ('python.exe', 'pythonw.exe', 'python3.dll', f'python{sys.version_info.major}{sys.version_info.minor}.dll',
                 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt'):
        copy_file(base / name, target / name)
    for item in (base / 'DLLs').iterdir():
        if not re.match(r'(_tkinter|tcl|tk)', item.name):
            copy_file(item, target / 'DLLs' / item.name)
    for item in (base / 'Lib').rglob('*'):
        relative = item.relative_to(base / 'Lib')
        if item.is_file() and not STDLIB_SKIP.intersection(relative.parts):
            copy_file(item, target / 'Lib' / relative)
    dists = closure(RUNTIME_REQUIREMENTS)
    notices = []
    for name, dist in sorted(dists.items()):
        for entry in dist.files or []:
            parts = Path(entry).parts
            if parts[0] == '..' or '__pycache__' in parts or entry.suffix == '.pyc' or build_only(parts):
                continue
            copy_file(site_packages / entry, target / 'Lib' / 'site-packages' / entry)
        meta = dist.metadata
        license_name = meta.get('License-Expression') or next((c.split('::')[-1].strip() for c in meta.get_all('Classifier') or []
                                                               if c.startswith('License ::')), None) or (meta.get('License') or 'see package').splitlines()[0][:80]
        notices.append(f"{meta['Name']} {meta['Version']} — {license_name}\n    {meta.get('Home-page') or next((u.split(',', 1)[-1].strip() for u in meta.get_all('Project-URL') or []), '')}")
    return dists, notices


def stage():
    if ENGINE.exists():
        shutil.rmtree(ENGINE)
    site_packages = Path(next(p for p in sys.path if p.endswith('site-packages')))
    dists, notices = stage_python(site_packages)

    for module in BACKEND_MODULES:
        copy_file(PROJECT / 'boundary_ml' / f'{module}.py', ENGINE / 'backend' / 'boundary_ml' / f'{module}.py')

    copy_file(LLAMA / 'llama-server.exe', ENGINE / 'llama' / 'llama-server.exe')
    for dll in LLAMA.glob('*.dll'):
        copy_file(dll, ENGINE / 'llama' / dll.name)
    copy_file(LLAMA / 'LICENSE-LLVM-OpenMP', ENGINE / 'licenses' / 'LLVM-OpenMP-LICENSE.txt')
    copy_file(LLAMA_LICENSE, ENGINE / 'licenses' / 'llama.cpp-LICENSE.txt')

    for relative in ('models/base/Llama-3.2-1B-Instruct-Q4_K_M.gguf', 'models/carekoala-lora-v2.gguf'):
        copy_file(MODEL_ROOT / relative, ENGINE / 'model' / relative, link=True)

    for weights in ('craft_mlt_25k.pth', 'english_g2.pth'):
        copy_file(OCR_WEIGHTS / weights, ENGINE / 'easyocr' / 'model' / weights, link=True)
    # EasyOCR creates this folder on start; ship it so a read-only install works.
    (ENGINE / 'easyocr' / 'user_network').mkdir(parents=True, exist_ok=True)
    (ENGINE / 'easyocr' / 'user_network' / 'README.txt').write_text('Reserved for EasyOCR. CareKoala uses the bundled English models only.\n')

    copy_file(DOWNLOADS / 'vc_redist.x64.exe', ENGINE / 'redist' / 'vc_redist.x64.exe')
    copy_file(DOWNLOADS / 'LICENSE', ENGINE / 'licenses' / 'LLAMA-3.2-COMMUNITY-LICENSE.txt')
    copy_file(DOWNLOADS / 'USE_POLICY.md', ENGINE / 'licenses' / 'LLAMA-3.2-ACCEPTABLE-USE-POLICY.md')
    copy_file(Path(sys.base_prefix) / 'LICENSE.txt', ENGINE / 'licenses' / 'Python-LICENSE.txt')
    (ENGINE / 'licenses' / 'THIRD-PARTY-NOTICES.txt').write_text(
        'CareKoala — third-party components\n\n'
        'Built with Llama.\n'
        'The CareKoala safety model is a LoRA fine-tune of Meta Llama 3.2 1B Instruct (GGUF Q4_K_M).\n'
        'Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright (c) Meta Platforms, Inc.\n'
        'All Rights Reserved. See LLAMA-3.2-COMMUNITY-LICENSE.txt and LLAMA-3.2-ACCEPTABLE-USE-POLICY.md.\n\n'
        'llama.cpp (build b11036) — MIT. See llama.cpp-LICENSE.txt. Includes LLVM OpenMP (LLVM-OpenMP-LICENSE.txt).\n'
        'EasyOCR English detection/recognition weights — Apache-2.0, https://github.com/JaidedAI/EasyOCR\n'
        f'CPython {sys.version.split()[0]} — PSF License. See Python-LICENSE.txt.\n'
        'Microsoft Visual C++ Redistributable 14.44 — installed only when missing; Microsoft Software License Terms.\n'
        'Electron and Chromium — MIT/BSD; notices ship beside CareKoala.exe (LICENSE.electron.txt, LICENSES.chromium.html).\n'
        'Domain protection downloads https://github.com/StevenBlack/hosts at run time (MIT and per-source licenses).\n\n'
        'Python packages (license as declared in package metadata; full texts are inside each\n'
        'package folder under resources/engine/python/Lib/site-packages):\n\n'
        + '\n'.join(notices) + '\n', encoding='utf-8')

    # Neutral, hash-checked bytecode: fast start, no developer paths in tracebacks,
    # and valid regardless of the timestamps the installer writes.
    for tree, label in ((ENGINE / 'python' / 'Lib', 'python/Lib'), (ENGINE / 'backend', 'backend')):
        compileall.compile_dir(tree, ddir=f'CareKoala/{label}', quiet=2, workers=0,
                               invalidation_mode=compileall.py_compile.PycInvalidationMode.UNCHECKED_HASH)

    total = sum(f.stat().st_size for f in ENGINE.rglob('*') if f.is_file())
    print(f'Staged {len(dists)} Python distributions; {total / 2**30:.2f} GiB in {ENGINE}')
    for child in sorted(ENGINE.iterdir()):
        size = sum(f.stat().st_size for f in child.rglob('*') if f.is_file())
        print(f'  {child.name:10} {size / 2**20:9.1f} MiB')


if __name__ == '__main__':
    stage()

"""Installation et vérification de l'environnement CXAS (Étapes 4-6).

Usage :
  python scripts/radiography/anatomy/install_cxas.py                # tout
  python scripts/radiography/anatomy/install_cxas.py --patch-only   # patch seulement
  python scripts/radiography/anatomy/install_cxas.py --weights-only # poids seulement
  python scripts/radiography/anatomy/install_cxas.py --verify-only  # self-test

Réseau précautionneux : pip est invoqué avec retries/timeout élevés ;
les poids (gdown) sont relancés jusqu'à --max-download-attempts. Toutes
les étapes sont idempotentes et applicables séparément.

Le patch « lazy » rend cxas compatible avec pydicom >= 3 (le serveur a
pydicom 3.0.2) : SimpleITK et pydicom_seg ne sont importés qu'au moment
réel de leur usage, jamais à l'import de cxas. Validé en conditions
réelles (Python 3.14.5) : `import cxas` ne charge alors ni pydicom, ni
pydicom_seg, ni SimpleITK, ni skimage.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import textwrap
from pathlib import Path

PYTHON = sys.executable
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CXAS_PATH = Path(os.environ.get("CXAS_PATH", Path.home() / ".cxas"))

# Dépendances runtime minimales de cxas 0.0.18. SimpleITK en optionnel :
# lecture DICOM uniquement (JPG/PNG suffisent pour la validation).
DEPS_REQUIRED = ("gdown", "colorcet", "beautifulsoup4", "soupsieve", "pycocotools")
DEPS_OPTIONAL = ("SimpleITK",)

PIP_FLAGS = ("--disable-pip-version-check", "--retries", "10", "--timeout", "60")

PATCH_MARKER = "# lazy: CXAS patch"


# ---------------------------------------------------------------------------
# Patch lazy (mêmes modifications que la copie de test validée)
# ---------------------------------------------------------------------------

def apply_lazy_patch(site_packages: str) -> None:
    """Idempotent : ne modifie un fichier que s'il n'est pas déjà marqué."""
    cxas_dir = Path(site_packages) / "cxas"

    # --- file_io.py : SimpleITK et write_dicom_seg en import paresseux
    file_io = cxas_dir / "file_io.py"
    if PATCH_MARKER not in file_io.read_text(encoding="utf-8"):
        text = file_io.read_text(encoding="utf-8")
        for line in (
            "import SimpleITK as sitk\n",
            "from cxas.io_utils.dicomseg_2d import write_dicom_seg\n",
        ):
            if line not in text:
                raise RuntimeError(f"{file_io.name} : motif introuvable {line!r}")
            text = text.replace(line, "", 2 if line.startswith("import SimpleITK")
                                else 1)
        # signatures une ligne d'origine (whl 0.0.18)
        sig_dicom = "    def load_dicom(self, image_path: str) -> dict:\n"
        if sig_dicom not in text:
            raise RuntimeError(
                f"{file_io.name} : signature load_dicom non reconnue"
            )
        text = text.replace(
            sig_dicom,
            sig_dicom + "        import SimpleITK as sitk  "
            + f"{PATCH_MARKER}\n",
            1,
        )
        anchor = "        out_dir = os.path.join(outdir, " \
                 "os.path.splitext(file_name)[0].split(\"/\")[-1])"
        if anchor not in text:
            raise RuntimeError(
                f"{file_io.name} : ancre export_prediction_as_dicomseg introuvable"
            )
        text = text.replace(
            anchor,
            "        from cxas.io_utils.dicomseg_2d import write_dicom_seg  "
            + f"{PATCH_MARKER}\n" + anchor,
            1,
        )
        file_io.write_text(text, encoding="utf-8")
        print(f"  [ok]   {file_io.name} patché")
    else:
        print(f"  [skip] {file_io.name} déjà patché")

    # --- radiomics.py : SimpleITK paresseux (branché pyradiomics)
    radiomics = cxas_dir / "extraction" / "radiomics.py"
    if PATCH_MARKER not in radiomics.read_text(encoding="utf-8"):
        text = radiomics.read_text(encoding="utf-8")
        if "import SimpleITK as sitk\n" not in text:
            raise RuntimeError(f"{radiomics.name} : motif SimpleITK introuvable")
        text = text.replace(
            "import SimpleITK as sitk\n",
            "",
            1,
        ).replace(
            "def get_radiomics(mask, img=None, draw=False):\n",
            "def get_radiomics(mask, img=None, draw=False):\n"
            f"    import SimpleITK as sitk  {PATCH_MARKER}\n",
            1,
        )
        radiomics.write_text(text, encoding="utf-8")
        print(f"  [ok]   {radiomics.name} patché")
    else:
        print(f"  [skip] {radiomics.name} déjà patché")

    # --- create_annotations.py : suppression d'un import mort (skimage)
    annotations = cxas_dir / "io_utils" / "create_annotations.py"
    text = annotations.read_text(encoding="utf-8")
    if "from skimage import measure\n" in text:
        annotations.write_text(
            text.replace("from skimage import measure\n", "", 1),
            encoding="utf-8",
        )
        print(f"  [ok]   {annotations.name} nettoyé (import mort skimage)")
    else:
        print(f"  [skip] {annotations.name} déjà propre")

    # --- models/__init__.py : compat gdown 6 (fuzzy= retiré de gdown 6)
    models_init = cxas_dir / "models" / "__init__.py"
    if "gdown6: CXAS patch" not in models_init.read_text(encoding="utf-8"):
        text = models_init.read_text(encoding="utf-8")
        old = "result = gdown.download(model_urls[model_name], out_path, " \
              "quiet=False, fuzzy=True)"
        if old not in text:
            raise RuntimeError(
                f"{models_init.name} : appel gdown.download non reconnu"
            )
        text = text.replace(
            old,
            "result = gdown.download(  # gdown6: CXAS patch\n"
            "    model_urls[model_name], out_path, quiet=False\n"
            ")",
            1,
        )
        models_init.write_text(text, encoding="utf-8")
        print(f"  [ok]   {models_init.name} patché (gdown 6)")
    else:
        print(f"  [skip] {models_init.name} déjà patché (gdown 6)")

    print(f"  Patch lazy appliqué dans {cxas_dir}")


# ---------------------------------------------------------------------------
# Étapes
# ---------------------------------------------------------------------------

def step_pip(wheels_dir: Path | None, with_simpleitk: bool) -> None:
    print("\n[1/4] Installation des paquets (cxas --no-deps + dépendances)")
    cmd_install = [PYTHON, "-m", "pip", "install", *PIP_FLAGS]
    if wheels_dir and wheels_dir.exists():
        for wheel in sorted(wheels_dir.glob("*.whl")):
            cmd_install.append(str(wheel))
    subprocess.run([*cmd_install, "cxas", "--no-deps"], check=True)

    subprocess.run(
        [PYTHON, "-m", "pip", "install", *PIP_FLAGS, *DEPS_REQUIRED]
        + (list(DEPS_OPTIONAL) if with_simpleitk else []),
        check=True,
    )


def step_patch() -> None:
    print("\n[2/4] Patch lazy (compatibilité pydicom 3)")
    import site

    # Localise l'installation de cxas sans l'importer (l'import échoue
    # avant patch, faute de SimpleITK — c'est justement le bug corrigé).
    candidates = [
        Path(site.getusersitepackages()),
        *(Path(p) for p in site.getsitepackages()),
    ]
    cxas_dir = next((p / "cxas" for p in candidates if (p / "cxas").exists()), None)
    if cxas_dir is None:
        raise SystemExit("cxas introuvable dans les site-packages (user et système).")
    apply_lazy_patch(str(cxas_dir.parent))
    print(f"  (cxas localisé dans {cxas_dir})")


def step_weights(max_download_attempts: int, cxas_path: Path) -> None:
    # cxas imbrique le dossier ".cxas" sous CXAS_PATH (=> CXAS_PATH/.cxas/weights).
    weights_dir = cxas_path / ".cxas" / "weights"
    weights_file = weights_dir / "UNet_ResNet50_default.pth"
    print(f"\n[3/4] Téléchargement des poids (dossier: {weights_dir})")
    if weights_file.exists() and weights_file.stat().st_size > 100_000_000:
        for stale in weights_dir.glob("*.part"):  # résidus de reprise
            stale.unlink(missing_ok=True)
        print(f"  [ok]   {weights_file} présent "
              f"({weights_file.stat().st_size / 1e6:.0f} Mo) — rien à faire")
        return

    script = (
        "import cxas\n"
        "from cxas import CXAS\n"
        "CXAS('UNet_ResNet50_default', 'cpu')\n"
        "print('poids OK')\n"
    )
    env = {**os.environ, "CXAS_PATH": str(cxas_path)}
    for attempt in range(1, max_download_attempts + 1):
        print(f"  essai {attempt}/{max_download_attempts} ...")
        try:
            run = subprocess.run(
                [PYTHON, "-c", script], env=env,
                capture_output=True, text=True, timeout=1800,
            )
        except subprocess.TimeoutExpired:
            print("  timeout (réseau lent), nouvelle tentative")
            continue
        if run.returncode == 0 and "poids OK" in run.stdout:
            print("  [ok]   poids téléchargés")
            return
        print((run.stderr or run.stdout)[-800:])
    raise SystemExit(
        "Échec du téléchargement des poids — relancer quand le réseau "
        "est plus stable."
    )


def step_verify(cxas_path: Path) -> None:
    print("\n[4/4] Auto-vérification (masques synthétiques, CPU)")
    verify = textwrap.dedent("""
        import numpy as np, cv2
        from cxas import CXAS
        from cxas.label_mapper import id2label_dict
        eng = CXAS("UNet_ResNet50_default", "cpu")
        assert len(id2label_dict) == 159
        m = np.zeros((159, 512, 512), bool)
        cv2.circle(m[134], (240, 200), 170, True, -1)   # lung
        cv2.circle(m[121], (240, 430), 90, True, -1)    # heart
        cv2.circle(m[107], (240, 480), 60, True, -1)    # right hemidiaphragm
        for v in (11, 12, 13, 14):                      # vertèbres T1-T4
            cv2.circle(m[v], (240, 240 + 24 * (v - 11)), 22, True, -1)
        ctr = eng.extractor.extract(file=m, image=None, method="Cardio-Thoracic Ratio")
        scd = eng.extractor.extract(file=m, image=None, method="Spine-Center Distance")
        assert 0 <= ctr["score"] <= 1, ctr
        assert scd["score"] >= 0, scd
        print("labels=159 OK, CTR=%.4f, SCD=%.4f" % (ctr["score"], scd["score"]))
        print("CXAS opérationnel pour l'analyse d'images réelles")
    """)
    subprocess.run(
        [PYTHON, "-c", verify],
        env={**os.environ, "CXAS_PATH": str(cxas_path)},
        check=True,
    )


# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Installe et vérifie l'environnement CXAS (anatomie).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--wheels-dir", type=Path,
                        help="dossier de wheels locaux (réseau lent)")
    parser.add_argument("--with-simpleitk", action="store_true",
                        help="installe SimpleITK (lecture DICOM, ~20 Mo)")
    parser.add_argument("--patch-only", action="store_true")
    parser.add_argument("--weights-only", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--max-download-attempts", type=int, default=5,
                        help="tentatives de téléchargement des poids")
    parser.add_argument("--cxas-path", type=Path, default=None,
                        help="dossier des poids (défaut: CXAS_PATH ou ~/.cxas)")
    args = parser.parse_args()

    cxas_path = args.cxas_path or DEFAULT_CXAS_PATH

    if args.verify_only:
        step_verify(cxas_path)
        return
    if args.patch_only:
        step_patch()
        return
    if args.weights_only:
        step_weights(args.max_download_attempts, cxas_path)
        step_verify(cxas_path)
        return

    step_pip(args.wheels_dir, args.with_simpleitk)
    step_patch()
    step_weights(args.max_download_attempts, cxas_path)
    step_verify(cxas_path)
    print("\nEnvironnement CXAS prêt.")


if __name__ == "__main__":
    main()
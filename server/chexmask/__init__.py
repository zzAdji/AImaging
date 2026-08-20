"""Paquet ''chexmask'' : landmarks HybridGNet (poumons + cœur) + mesures.

Charge paresseuse : seul le module graph (numpy/scipy) est léger ;
``model`` (torch_geometric) et ``inference`` (torch, cv2) ne sont importés
qu'à la première analyse réelle via ``chexmask_service``.
"""
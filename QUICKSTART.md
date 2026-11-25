# Démarrage rapide pour un club

## Lancer Swish

1. Installez Docker Engine et Docker Compose sur un VPS ou un serveur du club.
2. Clonez le dépôt, puis configurez le nom de domaine dans Nginx Proxy Manager avec le conteneur `swish` et le port `8080`.
3. Sur un domaine HTTPS, lancez `docker compose up -d --build`.
4. Ouvrez **Administration → Créer un espace club** pour créer l’espace du club. Les données de concours sont ensuite synchronisées entre les appareils connectés à cet espace.
5. Depuis l’espace propriétaire, générez un code d’invitation pour chaque membre. Les invitations sont à usage unique et expirent après sept jours.
6. Personnalisez le nom, l’accroche, la couleur et le logo du club. Un logo de 512 Ko maximum est accepté.
7. Créez un concours, choisissez sa catégorie et son format, puis utilisez **Affichage public** lors de l’événement.
8. Pour publier les résultats, générez un lien public depuis l’espace club. Ce lien donne accès aux résultats finalisés du concours actif pendant 30 jours.

## Démonstration

La démonstration contient uniquement des données fictives et se lance avec `https://votre-domaine/?demo=1`. Les modifications de démonstration restent dans le navigateur de démonstration et ne sont jamais envoyées vers un compte club.

## Accès hors ligne

Après une première visite en ligne, l’application peut afficher sa coquille hors ligne sur les navigateurs prenant en charge les service workers. Les enregistrements effectués hors ligne restent en local ; reconnectez-vous puis utilisez **Réessayer la synchronisation** pour les envoyer. Les nouvelles sessions, invitations et liens publics nécessitent une connexion Internet.

## Confidentialité et conservation

Les noms des participants, les scores, le classement, les catégories et la durée sont conservés dans le volume Docker `swish-data` du serveur du club. Les mots de passe sont stockés sous forme de dérivés PBKDF2, et les sessions utilisent des cookies HttpOnly. Les liens publics donnent les noms des joueurs et leurs résultats finalisés ; révoquez un lien en générant un nouveau, et évitez d’y inclure des informations sensibles. Le club doit informer les participants et responsables légaux de l’usage de leurs noms et résultats et limiter les informations collectées. Configurez des sauvegardes chiffrées et régulières du volume `swish-data` ; l’application ne les transmet à aucun tiers.

Le mode démonstration n’est pas un espace cloisonné multi-locataire sur un domaine partagé. Déployez-le sur une instance de démonstration distincte avant de communiquer un lien public.
